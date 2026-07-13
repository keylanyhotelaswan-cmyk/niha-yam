-- OES Shift Handover RPCs (part 2)

DROP FUNCTION IF EXISTS public.close_shift(numeric, text, text);
DROP FUNCTION IF EXISTS public.open_shift(numeric);

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

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_handovers WHERE shift_id = v_shift AND status = 'pending'
  ) THEN RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

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
  WHERE id = v_shift;

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

CREATE OR REPLACE FUNCTION public.recreate_shift_handover(p_shift_id uuid, p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift public.shifts%ROWTYPE;
  v_drawer uuid;
  v_amount numeric;
  v_kind public.shift_handover_kind;
  v_ref text;
  v_hid uuid;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_destination NOT IN ('to_main', 'to_next_shift') THEN RAISE EXCEPTION 'INVALID_DESTINATION'; END IF;
  v_kind := p_destination::public.shift_handover_kind;

  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_shift.status <> 'closed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_handovers WHERE shift_id = p_shift_id AND status = 'pending') THEN
    RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_handovers WHERE shift_id = p_shift_id AND status = 'executed') THEN
    RAISE EXCEPTION 'HANDOVER_ALREADY_EXECUTED';
  END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  v_amount := public.treasury_balance(v_drawer);
  v_ref := public.next_financial_ref(v_rest, 'handover', 'HO');

  INSERT INTO public.shift_handovers
    (restaurant_id, reference, shift_id, kind, amount, status, created_by)
  VALUES (v_rest, v_ref, p_shift_id, v_kind, v_amount, 'pending', v_actor)
  RETURNING id INTO v_hid;

  PERFORM public.log_audit_event(v_rest, 'handover.re_requested', NULL, v_actor, 'shift_handover', v_hid, NULL,
    jsonb_build_object('kind', p_destination, 'amount', v_amount, 'reference', v_ref, 'shift_id', p_shift_id));

  RETURN jsonb_build_object(
    'handover_id', v_hid, 'reference', v_ref, 'kind', p_destination,
    'amount', v_amount, 'status', 'pending'
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
BEGIN
  SELECT * INTO v_h FROM public.shift_handovers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_h.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_h.kind <> 'to_main' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;

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
  WHERE id = p_id;

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
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_h FROM public.shift_handovers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_h.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_h.kind = 'to_main' AND NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.shift_handovers
  SET status = 'rejected', rejected_by = v_actor, rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(v_rest, 'handover.rejected', NULL, v_actor, 'shift_handover', p_id, NULL,
    jsonb_build_object('reason', trim(p_reason), 'reference', v_h.reference, 'kind', v_h.kind));
END;
$$;

CREATE OR REPLACE FUNCTION public.open_shift(
  p_opening_float numeric,
  p_receive_handover_id uuid DEFAULT NULL
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
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open') THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;
  IF v_float < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  SELECT * INTO v_pending FROM public.shift_handovers
  WHERE restaurant_id = v_rest AND status = 'pending' AND kind = 'to_next_shift'
  ORDER BY created_at LIMIT 1;
  v_has_pending_next := FOUND;

  IF v_has_pending_next THEN
    IF p_receive_handover_id IS NULL OR p_receive_handover_id <> v_pending.id THEN
      RAISE EXCEPTION 'PENDING_NEXT_HANDOVER';
    END IF;
    v_float := 0;
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
    SET status = 'executed', received_by = v_actor, received_at = now(), target_shift_id = v_shift
    WHERE id = v_pending.id;
    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_pending.id, NULL,
      jsonb_build_object('kind', 'to_next_shift', 'amount', v_pending.amount,
        'reference', v_pending.reference, 'target_shift_id', v_shift));
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', v_float, 'reference', v_ref,
      'received_handover_id', p_receive_handover_id));
  RETURN v_shift;
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_drop(p_amount numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_safe uuid;
  v_shift uuid;
  v_transfer uuid;
  v_ref text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  PERFORM public.assert_no_pending_handover(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;
  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;
  IF public.treasury_balance(v_drawer) < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  v_ref := public.next_financial_ref(v_rest, 'cash_drop', 'CD');
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, v_drawer, v_safe, p_amount, nullif(trim(coalesce(p_reason, '')), ''),
     true, 'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_transfer;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_drawer, v_shift, -p_amount, 'transfer_out', v_transfer, v_ref, v_actor),
    (v_rest, v_safe, v_shift, p_amount, 'transfer_in', v_transfer, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'cash_drop.executed', NULL, v_actor, 'treasury_transfer',
    v_transfer, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref));
  RETURN v_transfer;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_transfer(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_t public.treasury_transfers%ROWTYPE;
  v_safe uuid;
BEGIN
  SELECT * INTO v_t FROM public.treasury_transfers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_safe IS NOT NULL AND v_t.dest_treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  IF public.treasury_balance(v_t.source_treasury_id) < v_t.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  UPDATE public.treasury_transfers
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now()
  WHERE id = p_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_t.source_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', p_id, v_t.reference, public.auth_staff_id()),
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', p_id, v_t.reference, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('amount', v_t.amount));
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_adjustment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_a public.treasury_adjustments%ROWTYPE;
  v_safe uuid;
  v_amount numeric;
BEGIN
  SELECT * INTO v_a FROM public.treasury_adjustments WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_safe := public.main_cash_treasury_id(v_rest);
  IF v_a.kind = 'deposit' AND v_safe IS NOT NULL AND v_a.treasury_id = v_safe
     AND public.restaurant_has_pending_handover(v_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;

  IF v_a.kind = 'withdrawal' AND public.treasury_balance(v_a.treasury_id) < v_a.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_amount := CASE WHEN v_a.kind = 'deposit' THEN v_a.amount ELSE -v_a.amount END;

  UPDATE public.treasury_adjustments
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now()
  WHERE id = p_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment', p_id,
    v_a.reference, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'adjustment.executed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('kind', v_a.kind, 'amount', v_a.amount));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_handovers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at)
    FROM (
      SELECT h.id, h.reference, h.shift_id, s.reference AS shift_reference,
        h.kind::text AS kind, h.amount, h.status::text AS status, h.created_at,
        st.display_name AS cashier_name, h.created_by
      FROM public.shift_handovers h
      JOIN public.shifts s ON s.id = h.shift_id
      LEFT JOIN public.staff st ON st.id = h.created_by
      WHERE h.restaurant_id = v_rest AND h.status = 'pending'
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_shifts_archive(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.opened_at DESC)
    FROM (
      SELECT s.id, s.reference, s.status, s.opened_at, s.closed_at, s.actual_cash_count,
        opener.display_name AS opened_by_name, closer.display_name AS closed_by_name,
        (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', h.id, 'reference', h.reference, 'kind', h.kind::text,
            'amount', h.amount, 'status', h.status::text,
            'created_at', h.created_at, 'received_at', h.received_at,
            'rejected_at', h.rejected_at, 'rejection_reason', h.rejection_reason,
            'cashier_name', cs.display_name, 'received_by_name', rs.display_name
          ) ORDER BY h.created_at), '[]'::jsonb)
          FROM public.shift_handovers h
          LEFT JOIN public.staff cs ON cs.id = h.created_by
          LEFT JOIN public.staff rs ON rs.id = h.received_by
          WHERE h.shift_id = s.id
        ) AS handovers
      FROM public.shifts s
      LEFT JOIN public.staff opener ON opener.id = s.opened_by
      LEFT JOIN public.staff closer ON closer.id = s.closed_by
      WHERE s.restaurant_id = v_rest
      ORDER BY s.opened_at DESC
      LIMIT LEAST(coalesce(p_limit, 50), 200)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shift_archive(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_report jsonb;
  v_handovers jsonb;
  v_orders jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  v_report := public.get_shift_report(p_shift_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'reference', h.reference, 'kind', h.kind::text,
    'amount', h.amount, 'status', h.status::text,
    'created_at', h.created_at, 'received_at', h.received_at,
    'rejected_at', h.rejected_at, 'rejection_reason', h.rejection_reason,
    'cashier_name', cs.display_name, 'received_by_name', rs.display_name,
    'rejected_by_name', js.display_name, 'target_shift_id', h.target_shift_id,
    'transfer_id', h.transfer_id
  ) ORDER BY h.created_at), '[]'::jsonb)
  INTO v_handovers
  FROM public.shift_handovers h
  LEFT JOIN public.staff cs ON cs.id = h.created_by
  LEFT JOIN public.staff rs ON rs.id = h.received_by
  LEFT JOIN public.staff js ON js.id = h.rejected_by
  WHERE h.shift_id = p_shift_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'order_type', o.order_type::text,
    'payment_status', o.payment_status::text, 'fulfillment_status', o.fulfillment_status::text,
    'total', o.total, 'created_at', o.created_at
  ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_orders
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest;

  RETURN jsonb_build_object('report', v_report, 'handovers', v_handovers, 'orders', v_orders);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pos_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift uuid;
  v_pending jsonb;
  v_next jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT id INTO v_shift FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  v_pending := public.list_pending_handovers();
  SELECT x INTO v_next FROM jsonb_array_elements(v_pending) AS t(x)
  WHERE (x->>'kind') = 'to_next_shift' LIMIT 1;

  RETURN jsonb_build_object(
    'open_shift', CASE WHEN v_shift IS NULL THEN NULL ELSE public.get_shift_report(v_shift) END,
    'payment_methods', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pm.id, 'name', pm.name, 'code', pm.code,
        'treasury_id', pm.treasury_id, 'sort_order', pm.sort_order
      ) ORDER BY pm.sort_order)
      FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.is_active = true AND pm.treasury_id IS NOT NULL
    ), '[]'::jsonb),
    'delivery_drivers', public.list_delivery_drivers(true),
    'operational_treasuries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'code',
          CASE
            WHEN t.is_shift_drawer THEN 'drawer'
            WHEN pm.code IS NOT NULL THEN pm.code
            ELSE 'other'
          END,
        'balance', CASE
          WHEN v_shift IS NOT NULL THEN public.m5b_operational_treasury_balance(t.id, v_shift)
          ELSE public.treasury_balance(t.id)
        END,
        'approved_balance', public.treasury_balance(t.id)
      ) ORDER BY t.sort_order)
      FROM public.treasuries t
      LEFT JOIN public.payment_methods pm ON pm.treasury_id = t.id AND pm.restaurant_id = v_rest
      WHERE t.restaurant_id = v_rest AND t.is_active = true
        AND (t.is_shift_drawer = true OR pm.code IN ('instapay', 'ewallet'))
    ), '[]'::jsonb),
    'operational_drawer_balance', (
      SELECT CASE WHEN v_shift IS NULL OR t.id IS NULL THEN NULL
        ELSE public.m5b_operational_treasury_balance(t.id, v_shift) END
      FROM public.treasuries t
      WHERE t.restaurant_id = v_rest AND t.is_shift_drawer = true AND t.is_active = true
      LIMIT 1
    ),
    'can_discount', public.pos_staff_can_discount(),
    'can_open_shift', v_shift IS NULL,
    'can_close_shift', v_shift IS NOT NULL,
    'can_approve_collections', public.is_owner_or_manager(),
    'can_manage_drivers', public.is_owner_or_manager(),
    'pending_handovers', v_pending,
    'pending_next_shift_handover', v_next,
    'has_pending_handover', public.restaurant_has_pending_handover(v_rest)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_shift(numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_shift(numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recreate_shift_handover(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_treasury_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_shift_handover(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_handovers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shifts_archive(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_archive(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
