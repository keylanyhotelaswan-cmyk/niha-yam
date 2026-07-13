-- Operational Hardening v1.1
-- OH-1: collection totals include payment_status by scope
-- OH-5: row locks / idempotent receive on handover money path

-- =============================================================================
-- OH-1: Shift / day collection totals + payment_status aggregates
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_shift_collection_totals(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_by jsonb;
  v_total numeric := 0;
  v_trust numeric := 0;
  v_paid numeric := 0;
  v_unpaid numeric := 0;
  v_partial numeric := 0;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_order, x.name), '[]'::jsonb)
  INTO v_by
  FROM (
    SELECT
      pm.id AS payment_method_id,
      pm.code,
      pm.name,
      pm.sort_order,
      round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount,
      bool_or(coalesce(t.is_shift_drawer, false) OR pm.code = 'cash') AS counts_toward_handover
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    LEFT JOIN public.treasuries t ON t.id = op.treasury_id
    WHERE o.restaurant_id = v_rest
      AND o.shift_id = p_shift_id
      AND op.collection_status IN ('pending', 'approved')
    GROUP BY pm.id, pm.code, pm.name, pm.sort_order
    HAVING round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) <> 0
  ) x;

  SELECT
    coalesce(sum((e->>'amount')::numeric), 0),
    coalesce(sum(CASE WHEN (e->>'counts_toward_handover')::boolean
      THEN (e->>'amount')::numeric ELSE 0 END), 0)
  INTO v_total, v_trust
  FROM jsonb_array_elements(v_by) e;

  SELECT
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'paid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'unpaid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'partial'), 0)
  INTO v_paid, v_unpaid, v_partial
  FROM public.orders o
  WHERE o.restaurant_id = v_rest AND o.shift_id = p_shift_id;

  RETURN jsonb_build_object(
    'scope', 'shift',
    'shift_id', p_shift_id,
    'by_payment_method', v_by,
    'total_collected', v_total,
    'trust_cash_total', v_trust,
    'by_collection_status', jsonb_build_object(
      'paid', round(v_paid::numeric, 2),
      'unpaid', round(v_unpaid::numeric, 2),
      'partial', round(v_partial::numeric, 2)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_day_collection_totals(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_day date := coalesce(p_date, (now() AT TIME ZONE 'Africa/Cairo')::date);
  v_from timestamptz;
  v_to timestamptz;
  v_by jsonb;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_unpaid numeric := 0;
  v_partial numeric := 0;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_from := (v_day::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Cairo';
  v_to := v_from + interval '1 day';

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_order, x.name), '[]'::jsonb)
  INTO v_by
  FROM (
    SELECT
      pm.id AS payment_method_id,
      pm.code,
      pm.name,
      pm.sort_order,
      round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount,
      bool_or(coalesce(t.is_shift_drawer, false) OR pm.code = 'cash') AS counts_toward_handover
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    LEFT JOIN public.treasuries t ON t.id = op.treasury_id
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND op.collection_status IN ('pending', 'approved')
    GROUP BY pm.id, pm.code, pm.name, pm.sort_order
    HAVING round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) <> 0
  ) x;

  SELECT coalesce(sum((e->>'amount')::numeric), 0) INTO v_total
  FROM jsonb_array_elements(v_by) e;

  SELECT
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'paid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'unpaid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'partial'), 0)
  INTO v_paid, v_unpaid, v_partial
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.created_at >= v_from AND o.created_at < v_to;

  RETURN jsonb_build_object(
    'scope', 'day',
    'date', v_day,
    'by_payment_method', v_by,
    'total_collected', v_total,
    'by_collection_status', jsonb_build_object(
      'paid', round(v_paid::numeric, 2),
      'unpaid', round(v_unpaid::numeric, 2),
      'partial', round(v_partial::numeric, 2)
    )
  );
END;
$$;

-- =============================================================================
-- OH-5: Lock shift / handover rows; idempotent Path A receive
-- =============================================================================
CREATE OR REPLACE FUNCTION public.close_shift(
  p_actual_cash_count numeric,
  p_difference_reason text,
  p_notes text,
  p_destination text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_expected numeric;
  v_diff numeric;
  v_vr text;
  v_amount numeric;
  v_kind public.shift_handover_kind;
  v_ref text;
  v_hid uuid;
  v_cashier text;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF coalesce(p_actual_cash_count, -1) < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_destination NOT IN ('to_main', 'to_next_shift') THEN RAISE EXCEPTION 'INVALID_DESTINATION'; END IF;
  v_kind := p_destination::public.shift_handover_kind;

  -- Serialize close against concurrent close / cash_drop / open
  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open'
  FOR UPDATE;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_handovers WHERE shift_id = v_shift AND status = 'pending'
  ) THEN RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  -- Lock drawer treasury row via balance movements path (balance is computed; lock handovers)
  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;

  v_expected := public.treasury_balance(v_drawer);
  v_diff := p_actual_cash_count - v_expected;

  IF v_diff <> 0 THEN
    IF length(trim(coalesce(p_difference_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'DIFFERENCE_REASON_REQUIRED';
    END IF;
    v_vr := public.next_financial_ref(v_rest, 'variance', 'VR');
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_diff, 'variance', 'shift', v_shift, v_vr, v_actor);
  END IF;

  UPDATE public.shifts
  SET status = 'closed', closed_by = v_actor, closed_at = now(),
      actual_cash_count = p_actual_cash_count,
      difference_reason = nullif(trim(coalesce(p_difference_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = v_shift AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  v_amount := public.treasury_balance(v_drawer);
  v_ref := public.next_financial_ref(v_rest, 'handover', 'HO');

  INSERT INTO public.shift_handovers
    (restaurant_id, reference, shift_id, kind, amount, status, created_by)
  VALUES (v_rest, v_ref, v_shift, v_kind, v_amount, 'pending', v_actor)
  RETURNING id INTO v_hid;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_actor;

  PERFORM public.log_audit_event(v_rest, 'shift.closed', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash_count, 'difference', v_diff,
      'destination', p_destination, 'handover_id', v_hid, 'handover_ref', v_ref));
  PERFORM public.log_audit_event(v_rest, 'handover.created', NULL, v_actor, 'shift_handover', v_hid, NULL,
    jsonb_build_object('kind', p_destination, 'amount', v_amount, 'reference', v_ref, 'shift_id', v_shift));

  RETURN jsonb_build_object(
    'shift_id', v_shift, 'handover_id', v_hid, 'reference', v_ref,
    'kind', p_destination, 'amount', v_amount,
    'cashier_name', coalesce(v_cashier, ''), 'status', 'pending'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_treasury_handover(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_h public.shift_handovers%ROWTYPE;
  v_drawer uuid;
  v_safe uuid;
  v_transfer uuid;
  v_cd text;
  v_updated int;
BEGIN
  SELECT * INTO v_h FROM public.shift_handovers
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_h.status = 'executed' THEN
    -- Idempotent: second click / refresh during receive must not double-credit
    RETURN jsonb_build_object(
      'handover_id', p_id, 'status', 'executed', 'amount', v_h.amount,
      'transfer_id', v_h.transfer_id, 'idempotent', true
    );
  END IF;
  IF v_h.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_h.kind <> 'to_main' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;
  PERFORM 1 FROM public.treasuries WHERE id = v_safe FOR UPDATE;

  IF v_h.amount > 0 THEN
    IF public.treasury_balance(v_drawer) < v_h.amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;
    v_cd := public.next_financial_ref(v_rest, 'cash_drop', 'CD');
    INSERT INTO public.treasury_transfers
      (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
       is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
    VALUES (v_rest, v_cd, v_h.shift_id, v_drawer, v_safe, v_h.amount,
       'Shift handover ' || v_h.reference,
       true, 'executed', v_actor, v_actor, now(), now(), true)
    RETURNING id INTO v_transfer;

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by,
       source_ref_type, source_ref_id)
    VALUES
      (v_rest, v_drawer, v_h.shift_id, -v_h.amount, 'transfer_out', v_transfer, v_h.reference, v_actor,
       'shift_handover', v_h.id),
      (v_rest, v_safe, v_h.shift_id, v_h.amount, 'transfer_in', v_transfer, v_h.reference, v_actor,
       'shift_handover', v_h.id);
  END IF;

  UPDATE public.shift_handovers
  SET status = 'executed', received_by = v_actor, received_at = now(), transfer_id = v_transfer
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', p_id, NULL,
    jsonb_build_object('kind', 'to_main', 'amount', v_h.amount, 'reference', v_h.reference,
      'transfer_id', v_transfer));

  RETURN jsonb_build_object('handover_id', p_id, 'status', 'executed', 'amount', v_h.amount,
    'transfer_id', v_transfer);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_shift_handover(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_h public.shift_handovers%ROWTYPE;
  v_updated int;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_h FROM public.shift_handovers
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_h.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_h.kind = 'to_main' AND NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.shift_handovers
  SET status = 'rejected', rejected_by = v_actor, rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  PERFORM public.log_audit_event(v_rest, 'handover.rejected', NULL, v_actor, 'shift_handover', p_id, NULL,
    jsonb_build_object('reason', trim(p_reason), 'reference', v_h.reference, 'kind', v_h.kind));
END;
$$;

CREATE OR REPLACE FUNCTION public.open_shift(
  p_opening_float numeric,
  p_receive_handover_id uuid DEFAULT NULL,
  p_received_actual_cash numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_ref text;
  v_pending public.shift_handovers%ROWTYPE;
  v_float numeric := coalesce(p_opening_float, 0);
  v_has_pending_next boolean := false;
  v_recv_actual numeric;
  v_recv_var numeric := 0;
  v_updated int;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open') THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;
  IF v_float < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;
  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;

  SELECT * INTO v_pending FROM public.shift_handovers
  WHERE restaurant_id = v_rest AND status = 'pending' AND kind = 'to_next_shift'
  ORDER BY created_at
  FOR UPDATE
  LIMIT 1;
  v_has_pending_next := FOUND;

  IF v_has_pending_next THEN
    IF p_receive_handover_id IS NULL OR p_receive_handover_id <> v_pending.id THEN
      RAISE EXCEPTION 'PENDING_NEXT_HANDOVER';
    END IF;
    IF p_received_actual_cash IS NULL THEN
      RAISE EXCEPTION 'RECEIVE_COUNT_REQUIRED';
    END IF;
    IF p_received_actual_cash < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_recv_actual := round(p_received_actual_cash::numeric, 2);
    v_recv_var := round((v_recv_actual - v_pending.amount)::numeric, 2);
  ELSIF p_receive_handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'shift', 'SH');
  INSERT INTO public.shifts (restaurant_id, reference, opened_by, status)
  VALUES (v_rest, v_ref, v_actor, 'open') RETURNING id INTO v_shift;

  IF v_float > 0 THEN
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_float, 'opening_float', 'shift', v_shift, v_ref, v_actor);
  END IF;

  IF v_has_pending_next THEN
    UPDATE public.shift_handovers
    SET status = 'executed',
        received_by = v_actor,
        received_at = now(),
        target_shift_id = v_shift,
        received_actual_cash = v_recv_actual,
        receive_variance = v_recv_var
    WHERE id = v_pending.id AND status = 'pending';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

    IF abs(v_recv_var) > 0.001 THEN
      INSERT INTO public.treasury_movements
        (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
         reference, created_by)
      VALUES (
        v_rest, v_drawer, v_shift, v_recv_var, 'variance', 'shift_handover', v_pending.id,
        public.next_financial_ref(v_rest, 'variance', 'VR'), v_actor
      );
    END IF;

    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_pending.id, NULL,
      jsonb_build_object(
        'kind', 'to_next_shift',
        'amount', v_pending.amount,
        'received_actual_cash', v_recv_actual,
        'receive_variance', v_recv_var,
        'reference', v_pending.reference,
        'target_shift_id', v_shift,
        'receiver_opening_float', v_float,
        'starting_trust', round((v_recv_actual + v_float)::numeric, 2)
      ));
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', v_float, 'reference', v_ref,
      'received_handover_id', p_receive_handover_id));
  RETURN v_shift;
END;
$$;
