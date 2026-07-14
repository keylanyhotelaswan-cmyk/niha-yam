-- Operational Stabilization: Ops Feedback refs + transfer race locks
-- No new features. Bug fixes only.

-- ---------------------------------------------------------------------------
-- 1) Ops Feedback: financial_ref must know ops_feedback (was falling through
--    to treasury_transfers). Root cause of UNIQUE / silent ref collisions on NT-*.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financial_ref_table_max(
  p_restaurant_id uuid, p_ref_type text, p_prefix text
)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max bigint := 0; v_part bigint;
BEGIN
  IF p_ref_type = 'order' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.orders WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'payment' THEN
    SELECT coalesce(max(substring(op.reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE o.restaurant_id = p_restaurant_id AND op.reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.kitchen_tickets WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'print_job' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.print_jobs WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'ops_feedback' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.ops_feedback WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type IN ('shift', 'cash_drop', 'transfer', 'expense', 'variance', 'deposit', 'withdrawal') THEN
    IF p_ref_type = 'shift' THEN
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.shifts WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    ELSIF p_ref_type = 'expense' THEN
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.expenses WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    ELSE
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.treasury_transfers WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    END IF;
    v_max := coalesce(v_part, 0);
  END IF;
  RETURN coalesce(v_max, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.financial_ref_exists(
  p_restaurant_id uuid, p_ref_type text, p_reference text
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ref_type = 'order' THEN
    RETURN EXISTS (SELECT 1 FROM public.orders WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'payment' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND op.reference = p_reference
    );
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    RETURN EXISTS (SELECT 1 FROM public.kitchen_tickets WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'print_job' THEN
    RETURN EXISTS (SELECT 1 FROM public.print_jobs WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'ops_feedback' THEN
    RETURN EXISTS (SELECT 1 FROM public.ops_feedback WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'shift' THEN
    RETURN EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'expense' THEN
    RETURN EXISTS (SELECT 1 FROM public.expenses WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSE
    RETURN EXISTS (SELECT 1 FROM public.treasury_transfers WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  END IF;
END; $$;

-- Sync counters for existing NT-* rows
INSERT INTO public.financial_ref_counters (restaurant_id, ref_type, current_value)
SELECT r.id, 'ops_feedback',
  public.financial_ref_table_max(r.id, 'ops_feedback', 'NT')
FROM public.restaurants r
ON CONFLICT (restaurant_id, ref_type) DO UPDATE SET
  current_value = GREATEST(
    public.financial_ref_counters.current_value,
    EXCLUDED.current_value
  );

-- ---------------------------------------------------------------------------
-- 2) Ops Feedback storage: scope by restaurant folder (path = {rest_id}/...)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ops_feedback_storage_select ON storage.objects;
DROP POLICY IF EXISTS ops_feedback_storage_insert ON storage.objects;

CREATE POLICY ops_feedback_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ops-feedback'
    AND (storage.foldername(name))[1] = public.auth_restaurant_id()::text
  );

CREATE POLICY ops_feedback_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ops-feedback'
    AND (storage.foldername(name))[1] = public.auth_restaurant_id()::text
  );

-- ---------------------------------------------------------------------------
-- 3) reject_transfer: FOR UPDATE + pending-only (parity with approve_transfer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_transfer(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_t public.treasury_transfers%ROWTYPE;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_t FROM public.treasury_transfers
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.treasury_transfers
  SET status = 'rejected',
      rejected_by = public.auth_staff_id(),
      rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'transfer.rejected', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

-- ---------------------------------------------------------------------------
-- 4) reverse_transfer: lock row + treasuries; executed-only CAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_transfer(p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_t public.treasury_transfers%ROWTYPE;
  v_new uuid;
  v_ref text;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_t FROM public.treasury_transfers
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_t.source_treasury_id FOR UPDATE;
  PERFORM 1 FROM public.treasuries WHERE id = v_t.dest_treasury_id FOR UPDATE;

  IF public.treasury_balance(v_t.dest_treasury_id) < v_t.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_ref := public.next_financial_ref(
    v_rest,
    CASE WHEN v_t.is_cash_drop THEN 'cash_drop' ELSE 'transfer' END,
    CASE WHEN v_t.is_cash_drop THEN 'CD' ELSE 'TR' END
  );

  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     is_cash_drop, status, created_by, approved_by, approved_at, executed_at, reverses_id, auto_approved)
  VALUES (
    v_rest, v_ref, v_t.shift_id, v_t.dest_treasury_id, v_t.source_treasury_id, v_t.amount,
    'reversal of ' || v_t.reference, v_t.is_cash_drop, 'executed', public.auth_staff_id(),
    public.auth_staff_id(), now(), now(), p_id, true
  )
  RETURNING id INTO v_new;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', v_new, v_ref, public.auth_staff_id()),
    (v_rest, v_t.source_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', v_new, v_ref, public.auth_staff_id());

  UPDATE public.treasury_transfers
  SET status = 'reversed',
      reversed_by = public.auth_staff_id(),
      reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id AND status = 'executed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'transfer.reversed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('reason', trim(p_reason), 'reversal_ref', v_ref));
  RETURN v_new;
END; $$;

-- ---------------------------------------------------------------------------
-- 5) pos_operational_transfer: cash-ops gate + treasury locks (drawer↔ digital)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_operational_transfer(
  p_source_treasury_id uuid,
  p_dest_treasury_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift uuid;
  v_src_drawer boolean;
  v_dst_drawer boolean;
  v_src_ok boolean;
  v_dst_ok boolean;
  v_transfer uuid;
  v_ref text;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  PERFORM public.assert_cash_ops_allowed();
  v_shift := public.pos_require_open_shift(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_source_treasury_id = p_dest_treasury_id THEN RAISE EXCEPTION 'SAME_TREASURY'; END IF;

  SELECT
    t.is_shift_drawer OR EXISTS (
      SELECT 1 FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.treasury_id = t.id
        AND pm.is_active = true AND pm.code IN ('instapay', 'ewallet')
    ),
    t.is_shift_drawer
  INTO v_src_ok, v_src_drawer
  FROM public.treasuries t
  WHERE t.id = p_source_treasury_id AND t.restaurant_id = v_rest AND t.is_active = true;
  IF NOT FOUND OR NOT v_src_ok THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;

  SELECT
    t.is_shift_drawer OR EXISTS (
      SELECT 1 FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.treasury_id = t.id
        AND pm.is_active = true AND pm.code IN ('instapay', 'ewallet')
    ),
    t.is_shift_drawer
  INTO v_dst_ok, v_dst_drawer
  FROM public.treasuries t
  WHERE t.id = p_dest_treasury_id AND t.restaurant_id = v_rest AND t.is_active = true;
  IF NOT FOUND OR NOT v_dst_ok THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;
  IF v_src_drawer = v_dst_drawer THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;

  -- Deterministic lock order
  IF p_source_treasury_id::text < p_dest_treasury_id::text THEN
    PERFORM 1 FROM public.treasuries WHERE id = p_source_treasury_id FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = p_dest_treasury_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.treasuries WHERE id = p_dest_treasury_id FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = p_source_treasury_id FOR UPDATE;
  END IF;

  IF public.treasury_balance(p_source_treasury_id) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'transfer', 'TR');
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, p_source_treasury_id, p_dest_treasury_id, p_amount,
    nullif(trim(coalesce(p_reason, '')), ''), false, 'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_transfer;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, p_source_treasury_id, v_shift, -p_amount, 'transfer_out', v_transfer, v_ref, v_actor),
    (v_rest, p_dest_treasury_id, v_shift, p_amount, 'transfer_in', v_transfer, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, v_actor, 'treasury_transfer',
    v_transfer, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref, 'pos_operational', true));
  RETURN v_transfer;
END; $$;

NOTIFY pgrst, 'reload schema';
