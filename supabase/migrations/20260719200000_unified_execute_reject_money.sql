-- Unified money lifecycle: execute on create → review → reject = reverse.
-- Removes pending→approve wait for expenses, transfers, adjustments, collections.
-- Path B shift handover receive is unchanged (physical receive, not F1 approve).

-- =============================================================================
-- 1) Operational drawer = ledger movements for the shift only
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m5b_operational_treasury_balance(
  p_treasury_id uuid,
  p_shift_id uuid
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
      SELECT sum(tm.amount)
      FROM public.treasury_movements tm
      WHERE tm.shift_id = p_shift_id
        AND tm.treasury_id = p_treasury_id
    ), 0);
$$;

-- =============================================================================
-- 2) Collections: auto-post ledger on insert (covers finalize_sale / record_*)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.m5b_auto_post_collection_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.collection_status = 'pending' THEN
    PERFORM public.m5b_post_collection_ledger(
      NEW.id,
      coalesce(NEW.created_by, public.auth_staff_id())
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_payments_auto_post ON public.order_payments;
CREATE TRIGGER trg_order_payments_auto_post
  AFTER INSERT ON public.order_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.m5b_auto_post_collection_on_insert();

-- =============================================================================
-- 3) Expenses: create = execute + ledger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.pos_record_expense(
  p_amount numeric,
  p_category public.expense_category DEFAULT 'petty_cash',
  p_description text DEFAULT NULL,
  p_vendor text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift uuid;
  v_drawer uuid;
  v_exp uuid;
  v_ref text;
  v_op_bal numeric;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  PERFORM public.assert_cash_ops_allowed();
  v_shift := public.pos_require_open_shift(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true AND is_active = true;
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;

  v_op_bal := public.m5b_operational_treasury_balance(v_drawer, v_shift);
  IF v_op_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'expense', 'EXP');
  INSERT INTO public.expenses
    (restaurant_id, reference, shift_id, treasury_id, category, amount, description, vendor,
     status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, v_drawer, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_exp;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_drawer, v_shift, -p_amount, 'expense', 'expense', v_exp, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'expense.created', NULL, v_actor, 'expense', v_exp, NULL,
    jsonb_build_object(
      'amount', p_amount, 'reference', v_ref, 'pos_operational', true, 'status', 'executed',
      'auto_approved', true
    ));
  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, v_actor, 'expense', v_exp, NULL,
    jsonb_build_object('amount', p_amount, 'reference', v_ref, 'auto_approved', true));
  RETURN v_exp;
END; $$;

CREATE OR REPLACE FUNCTION public.create_expense(
  p_treasury_id uuid, p_category public.expense_category, p_amount numeric,
  p_description text, p_vendor text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_ref text;
  v_is_drawer boolean;
  v_shift uuid;
  v_available numeric;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  PERFORM 1 FROM public.treasuries WHERE id = p_treasury_id FOR UPDATE;
  SELECT is_shift_drawer INTO v_is_drawer FROM public.treasuries WHERE id = p_treasury_id;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  IF coalesce(v_is_drawer, false) AND v_shift IS NOT NULL THEN
    v_available := public.m5b_operational_treasury_balance(p_treasury_id, v_shift);
  ELSE
    v_available := public.treasury_balance(p_treasury_id);
  END IF;
  IF v_available < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  IF NOT coalesce(v_is_drawer, false) THEN
    PERFORM public.liq_require_operating_funds(p_treasury_id, p_amount);
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'expense', 'EXP');
  INSERT INTO public.expenses
    (restaurant_id, reference, shift_id, treasury_id, category, amount, description, vendor,
     status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref,
    CASE WHEN coalesce(v_is_drawer, false) THEN v_shift ELSE NULL END,
    p_treasury_id, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (
    v_rest, p_treasury_id,
    CASE WHEN coalesce(v_is_drawer, false) THEN v_shift ELSE NULL END,
    -p_amount, 'expense', 'expense', v_id, v_ref, v_actor
  );

  PERFORM public.log_audit_event(v_rest, 'expense.created', NULL, v_actor,
    'expense', v_id, NULL, jsonb_build_object(
      'amount', p_amount, 'category', p_category, 'reference', v_ref, 'status', 'executed',
      'auto_approved', true
    ));
  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, v_actor,
    'expense', v_id, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref, 'auto_approved', true));
  RETURN v_id;
END; $$;

-- =============================================================================
-- 4) Transfers: create = execute + ledger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_transfer(
  p_source_treasury_id uuid, p_dest_treasury_id uuid, p_amount numeric, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_ref text;
  v_safe uuid;
  v_shift uuid;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_source_treasury_id = p_dest_treasury_id THEN RAISE EXCEPTION 'SAME_TREASURY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_source_treasury_id AND restaurant_id = v_rest)
     OR NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_dest_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NOT NULL AND p_dest_treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  PERFORM 1 FROM public.treasuries WHERE id = p_source_treasury_id FOR UPDATE;
  PERFORM 1 FROM public.treasuries WHERE id = p_dest_treasury_id FOR UPDATE;

  IF public.treasury_balance(p_source_treasury_id) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  v_ref := public.next_financial_ref(v_rest, 'transfer', 'TR');
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, p_source_treasury_id, p_dest_treasury_id, p_amount,
    nullif(trim(coalesce(p_reason, '')), ''), 'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, p_source_treasury_id, v_shift, -p_amount, 'transfer_out', v_id, v_ref, v_actor),
    (v_rest, p_dest_treasury_id, v_shift, p_amount, 'transfer_in', v_id, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'transfer.created', NULL, v_actor,
    'treasury_transfer', v_id, NULL, jsonb_build_object(
      'amount', p_amount, 'reference', v_ref, 'status', 'executed', 'auto_approved', true
    ));
  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, v_actor,
    'treasury_transfer', v_id, NULL, jsonb_build_object('amount', p_amount, 'auto_approved', true));
  RETURN v_id;
END; $$;

-- =============================================================================
-- 5) Adjustments: create = execute + ledger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_adjustment(
  p_treasury_id uuid, p_kind text, p_amount numeric, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_ref text;
  v_safe uuid;
  v_signed numeric;
BEGIN
  IF p_kind NOT IN ('deposit', 'withdrawal') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF p_kind = 'deposit' AND v_safe IS NOT NULL AND p_treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  PERFORM 1 FROM public.treasuries WHERE id = p_treasury_id FOR UPDATE;

  IF p_kind = 'withdrawal' AND public.treasury_balance(p_treasury_id) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_signed := CASE WHEN p_kind = 'deposit' THEN p_amount ELSE -p_amount END;
  v_ref := public.next_financial_ref(v_rest, p_kind, CASE WHEN p_kind = 'deposit' THEN 'DEP' ELSE 'WD' END);

  INSERT INTO public.treasury_adjustments
    (restaurant_id, reference, treasury_id, kind, amount, reason, status,
     created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, p_treasury_id, p_kind, p_amount, nullif(trim(coalesce(p_reason, '')), ''),
    'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, p_treasury_id, v_signed, p_kind::public.movement_source, 'adjustment', v_id, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'adjustment.created', NULL, v_actor,
    'treasury_adjustment', v_id, NULL, jsonb_build_object(
      'kind', p_kind, 'amount', p_amount, 'reference', v_ref, 'status', 'executed', 'auto_approved', true
    ));
  PERFORM public.log_audit_event(v_rest, 'adjustment.executed', NULL, v_actor,
    'treasury_adjustment', v_id, NULL, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'auto_approved', true));
  RETURN v_id;
END; $$;

-- =============================================================================
-- 6) Cutover: post any leftover pending rows once
-- =============================================================================
DO $$
DECLARE
  r record;
  v_actor uuid;
  v_is_drawer boolean;
  v_available numeric;
  v_safe uuid;
  v_signed numeric;
BEGIN
  -- Collections (trigger does not fire for existing rows)
  FOR r IN
    SELECT op.id, op.created_by, o.restaurant_id
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE op.collection_status = 'pending'
    ORDER BY op.created_at
  LOOP
    v_actor := coalesce(r.created_by, (
      SELECT s.id FROM public.staff s
      JOIN public.staff_branches sb ON sb.staff_id = s.id
      WHERE s.restaurant_id = r.restaurant_id
        AND sb.role IN ('owner', 'manager')
      ORDER BY s.created_at
      LIMIT 1
    ));
    IF v_actor IS NOT NULL THEN
      PERFORM public.m5b_post_collection_ledger(r.id, v_actor);
    END IF;
  END LOOP;

  -- Expenses
  FOR r IN
    SELECT e.* FROM public.expenses e WHERE e.status = 'pending' ORDER BY e.created_at
  LOOP
    v_actor := coalesce(r.created_by, (
      SELECT s.id FROM public.staff s
      JOIN public.staff_branches sb ON sb.staff_id = s.id
      WHERE s.restaurant_id = r.restaurant_id
        AND sb.role IN ('owner', 'manager')
      ORDER BY s.created_at
      LIMIT 1
    ));
    IF v_actor IS NULL THEN CONTINUE; END IF;

    SELECT is_shift_drawer INTO v_is_drawer FROM public.treasuries WHERE id = r.treasury_id;
    PERFORM 1 FROM public.treasuries WHERE id = r.treasury_id FOR UPDATE;

    IF coalesce(v_is_drawer, false) AND r.shift_id IS NOT NULL THEN
      v_available := public.m5b_operational_treasury_balance(r.treasury_id, r.shift_id) + r.amount;
    ELSE
      v_available := public.treasury_balance(r.treasury_id);
    END IF;

    IF v_available < r.amount THEN
      RAISE WARNING 'cutover skip expense % insufficient funds', r.id;
      CONTINUE;
    END IF;

    IF NOT coalesce(v_is_drawer, false) THEN
      BEGIN
        PERFORM public.liq_require_operating_funds(r.treasury_id, r.amount);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'cutover skip expense % liquidity: %', r.id, SQLERRM;
        CONTINUE;
      END;
    END IF;

    UPDATE public.expenses
    SET status = 'executed',
        approved_by = v_actor,
        approved_at = now(),
        executed_at = now(),
        auto_approved = true
    WHERE id = r.id AND status = 'pending';

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
    VALUES (r.restaurant_id, r.treasury_id, r.shift_id, -r.amount, 'expense', 'expense', r.id, r.reference, v_actor);
  END LOOP;

  -- Transfers
  FOR r IN
    SELECT t.* FROM public.treasury_transfers t WHERE t.status = 'pending' ORDER BY t.created_at
  LOOP
    v_actor := coalesce(r.created_by, (
      SELECT s.id FROM public.staff s
      JOIN public.staff_branches sb ON sb.staff_id = s.id
      WHERE s.restaurant_id = r.restaurant_id
        AND sb.role IN ('owner', 'manager')
      ORDER BY s.created_at
      LIMIT 1
    ));
    IF v_actor IS NULL THEN CONTINUE; END IF;

    PERFORM 1 FROM public.treasuries WHERE id = r.source_treasury_id FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = r.dest_treasury_id FOR UPDATE;

    IF public.treasury_balance(r.source_treasury_id) < r.amount THEN
      RAISE WARNING 'cutover skip transfer % insufficient funds', r.id;
      CONTINUE;
    END IF;

    UPDATE public.treasury_transfers
    SET status = 'executed',
        approved_by = v_actor,
        approved_at = now(),
        executed_at = now(),
        auto_approved = true
    WHERE id = r.id AND status = 'pending';

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
    VALUES
      (r.restaurant_id, r.source_treasury_id, r.shift_id, -r.amount, 'transfer_out', r.id, r.reference, v_actor),
      (r.restaurant_id, r.dest_treasury_id, r.shift_id, r.amount, 'transfer_in', r.id, r.reference, v_actor);
  END LOOP;

  -- Adjustments
  FOR r IN
    SELECT a.* FROM public.treasury_adjustments a WHERE a.status = 'pending' ORDER BY a.created_at
  LOOP
    v_actor := coalesce(r.created_by, (
      SELECT s.id FROM public.staff s
      JOIN public.staff_branches sb ON sb.staff_id = s.id
      WHERE s.restaurant_id = r.restaurant_id
        AND sb.role IN ('owner', 'manager')
      ORDER BY s.created_at
      LIMIT 1
    ));
    IF v_actor IS NULL THEN CONTINUE; END IF;

    PERFORM 1 FROM public.treasuries WHERE id = r.treasury_id FOR UPDATE;

    IF r.kind = 'withdrawal' AND public.treasury_balance(r.treasury_id) < r.amount THEN
      RAISE WARNING 'cutover skip adjustment % insufficient funds', r.id;
      CONTINUE;
    END IF;

    v_signed := CASE WHEN r.kind = 'deposit' THEN r.amount ELSE -r.amount END;

    UPDATE public.treasury_adjustments
    SET status = 'executed',
        approved_by = v_actor,
        approved_at = now(),
        executed_at = now(),
        auto_approved = true
    WHERE id = r.id AND status = 'pending';

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
    VALUES (r.restaurant_id, r.treasury_id, v_signed, r.kind::public.movement_source, 'adjustment', r.id, r.reference, v_actor);
  END LOOP;
END $$;

-- =============================================================================
-- 7) reverse_expense: include shift_id on credit movement
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reverse_expense(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_e public.expenses%ROWTYPE;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_e FROM public.expenses
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_e.treasury_id, v_e.shift_id, v_e.amount, 'expense', 'expense_reversal', p_id,
    v_e.reference, public.auth_staff_id());

  UPDATE public.expenses
  SET status = 'reversed',
      reversed_by = public.auth_staff_id(),
      reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id AND status = 'executed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'expense.reversed', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

-- =============================================================================
-- 8) reject_* = reverse when executed; legacy pending cancel otherwise
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reject_expense(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_e public.expenses%ROWTYPE;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_e FROM public.expenses
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_e.status = 'executed' THEN
    PERFORM public.reverse_expense(p_id, p_reason);
    RETURN;
  END IF;

  IF v_e.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.expenses
  SET status = 'rejected',
      rejected_by = public.auth_staff_id(),
      rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'expense.rejected', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

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

  IF v_t.status = 'executed' THEN
    PERFORM public.reverse_transfer(p_id, p_reason);
    RETURN;
  END IF;

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

CREATE OR REPLACE FUNCTION public.reject_adjustment(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_a public.treasury_adjustments%ROWTYPE;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_a FROM public.treasury_adjustments
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_a.status = 'executed' THEN
    PERFORM public.reverse_adjustment(p_id, p_reason);
    RETURN;
  END IF;

  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.treasury_adjustments
  SET status = 'rejected',
      rejected_by = public.auth_staff_id(),
      rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'adjustment.rejected', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_collection(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_op public.order_payments%ROWTYPE;
  v_updated int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT op.* INTO v_op
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.id = p_id AND o.restaurant_id = v_rest
  FOR UPDATE OF op;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  PERFORM 1 FROM public.orders WHERE id = v_op.order_id FOR UPDATE;

  IF v_op.collection_status = 'approved' THEN
    PERFORM public.reverse_collection(p_id, p_reason);
    RETURN;
  END IF;

  IF v_op.collection_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.order_payments
  SET collection_status = 'rejected',
      rejected_by = public.auth_staff_id(),
      rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id AND collection_status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.m5b_recalc_order_payment_status(v_op.order_id);
  PERFORM public.record_order_event(
    v_op.order_id, 'collection.rejected', 'order_payment', p_id,
    jsonb_build_object('reference', v_op.reference, 'reason', trim(p_reason))
  );
END; $$;

-- =============================================================================
-- 9) approve_* : safety net for residual pending; no-op if already posted
-- =============================================================================
CREATE OR REPLACE FUNCTION public.approve_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_e public.expenses%ROWTYPE;
  v_actor uuid := public.auth_staff_id();
  v_available numeric;
  v_is_drawer boolean;
  v_updated int;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status = 'executed' THEN RETURN; END IF;
  IF v_e.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  SELECT is_shift_drawer INTO v_is_drawer FROM public.treasuries WHERE id = v_e.treasury_id;
  PERFORM 1 FROM public.treasuries WHERE id = v_e.treasury_id FOR UPDATE;

  IF coalesce(v_is_drawer, false) AND v_e.shift_id IS NOT NULL THEN
    v_available := public.m5b_operational_treasury_balance(v_e.treasury_id, v_e.shift_id) + v_e.amount;
  ELSE
    v_available := public.treasury_balance(v_e.treasury_id);
  END IF;
  IF v_available < v_e.amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  IF NOT coalesce(v_is_drawer, false) THEN
    PERFORM public.liq_require_operating_funds(v_e.treasury_id, v_e.amount);
  END IF;

  UPDATE public.expenses
  SET status = 'executed', approved_by = v_actor, approved_at = now(), executed_at = now(),
      auto_approved = true
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_e.treasury_id, v_e.shift_id, -v_e.amount, 'expense', 'expense', p_id, v_e.reference, v_actor);

  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, v_actor,
    'expense', p_id, NULL, jsonb_build_object('amount', v_e.amount, 'reference', v_e.reference, 'legacy_approve', true));
END; $$;

CREATE OR REPLACE FUNCTION public.approve_transfer(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_t public.treasury_transfers%ROWTYPE;
  v_safe uuid;
  v_updated int;
BEGIN
  SELECT * INTO v_t FROM public.treasury_transfers
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status = 'executed' THEN RETURN; END IF;
  IF v_t.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NOT NULL AND v_t.dest_treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_t.source_treasury_id FOR UPDATE;
  PERFORM 1 FROM public.treasuries WHERE id = v_t.dest_treasury_id FOR UPDATE;

  IF public.treasury_balance(v_t.source_treasury_id) < v_t.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  UPDATE public.treasury_transfers
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now(),
      auto_approved = true
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_t.source_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', p_id, v_t.reference, public.auth_staff_id()),
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', p_id, v_t.reference, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('amount', v_t.amount, 'legacy_approve', true));
END; $$;

CREATE OR REPLACE FUNCTION public.approve_adjustment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_a public.treasury_adjustments%ROWTYPE;
  v_safe uuid;
  v_amount numeric;
  v_updated int;
BEGIN
  SELECT * INTO v_a FROM public.treasury_adjustments
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_a.status = 'executed' THEN RETURN; END IF;
  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_a.kind = 'deposit' AND v_safe IS NOT NULL AND v_a.treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_a.treasury_id FOR UPDATE;

  IF v_a.kind = 'withdrawal' AND public.treasury_balance(v_a.treasury_id) < v_a.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_amount := CASE WHEN v_a.kind = 'deposit' THEN v_a.amount ELSE -v_a.amount END;

  UPDATE public.treasury_adjustments
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now(),
      auto_approved = true
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment', p_id,
    v_a.reference, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'adjustment.executed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('kind', v_a.kind, 'amount', v_a.amount, 'legacy_approve', true));
END; $$;

CREATE OR REPLACE FUNCTION public.approve_collection(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_order_id uuid;
  v_status public.collection_status;
BEGIN
  SELECT op.order_id, op.collection_status INTO v_order_id, v_status
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.id = p_id AND o.restaurant_id = v_rest;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status = 'approved' THEN RETURN; END IF;

  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;
  PERFORM public.m5b_post_collection_ledger(p_id, public.auth_staff_id());
END; $$;

CREATE OR REPLACE FUNCTION public.approve_collections(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.approve_collection(v_id);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_pending_for_shift(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
  v_exp_ids uuid[];
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_count int := 0;
  v_exp_count int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Residual pending only (normal path posts on create)
  SELECT array_agg(op.id ORDER BY op.created_at), count(*)::int
  INTO v_ids, v_count
  FROM public.order_payments op
  WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending';

  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM public.m5b_post_collection_ledger(v_id, v_actor);
    END LOOP;
  END IF;

  SELECT array_agg(e.id ORDER BY e.created_at), count(*)::int
  INTO v_exp_ids, v_exp_count
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.status = 'pending';

  IF v_exp_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_exp_ids LOOP
      PERFORM public.approve_expense(v_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'approved_count', coalesce(v_count, 0),
    'approved_expenses_count', coalesce(v_exp_count, 0)
  );
END; $$;

-- reject_pending_for_shift: residual pending cancel only (executed use per-row reject→reverse)
CREATE OR REPLACE FUNCTION public.reject_pending_for_shift(p_shift_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
  v_exp_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_exp_count int := 0;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT array_agg(op.id ORDER BY op.created_at), count(*)::int
  INTO v_ids, v_count
  FROM public.order_payments op
  WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending';

  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM public.reject_collection(v_id, p_reason);
    END LOOP;
  END IF;

  SELECT array_agg(e.id ORDER BY e.created_at), count(*)::int
  INTO v_exp_ids, v_exp_count
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.status = 'pending';

  IF v_exp_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_exp_ids LOOP
      PERFORM public.reject_expense(v_id, p_reason);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'rejected_count', coalesce(v_count, 0),
    'rejected_expenses_count', coalesce(v_exp_count, 0)
  );
END; $$;

NOTIFY pgrst, 'reload schema';
