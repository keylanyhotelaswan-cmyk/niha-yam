-- 1) Heal inactive main cash safe (root cause of NO_CASH_SAFE on Testing).
-- 2) Refuse deactivating the only main cash vault.
-- 3) close_shift / cash_drop auto-heal before failing.

-- Reactivate the designated main cash vault when it was soft-disabled.
UPDATE public.treasuries t
SET is_active = true
WHERE t.type = 'cash'
  AND t.is_shift_drawer = false
  AND t.is_active = false
  AND NOT EXISTS (
    SELECT 1 FROM public.treasuries x
    WHERE x.restaurant_id = t.restaurant_id
      AND x.type = 'cash'
      AND x.is_shift_drawer = false
      AND x.is_active = true
  );

CREATE OR REPLACE FUNCTION public.ensure_main_cash_treasury_id(p_rest uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  v_id := public.main_cash_treasury_id(p_rest);
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Heal: re-enable the best inactive cash non-drawer candidate
  UPDATE public.treasuries
  SET is_active = true
  WHERE id = (
    SELECT id FROM public.treasuries
    WHERE restaurant_id = p_rest
      AND type = 'cash'
      AND is_shift_drawer = false
    ORDER BY sort_order, created_at
    LIMIT 1
  )
  AND is_active = false
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    v_id := public.main_cash_treasury_id(p_rest);
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_treasury_status(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_t public.treasuries%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.treasuries WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF p_active = false THEN
    IF public.treasury_balance(p_id) <> 0 THEN
      RAISE EXCEPTION 'TREASURY_NOT_EMPTY';
    END IF;
    -- Never deactivate the only main cash vault (handover / cash_drop need it)
    IF v_t.type = 'cash' AND v_t.is_shift_drawer = false THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.treasuries
        WHERE restaurant_id = v_rest
          AND type = 'cash'
          AND is_shift_drawer = false
          AND is_active = true
          AND id <> p_id
      ) THEN
        RAISE EXCEPTION 'MAIN_CASH_REQUIRED';
      END IF;
    END IF;
  END IF;

  UPDATE public.treasuries SET is_active = p_active WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'treasury.status_changed', NULL, public.auth_staff_id(),
    'treasury', p_id, NULL, jsonb_build_object('active', p_active));
END; $$;

-- Patch cash_drop to heal main before NO_CASH_SAFE
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
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  PERFORM public.assert_cash_ops_allowed();
  PERFORM public.assert_no_pending_handover(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;
  v_safe := public.ensure_main_cash_treasury_id(v_rest);
  IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;

  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;
  PERFORM 1 FROM public.treasuries WHERE id = v_safe FOR UPDATE;

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

-- Patch close_shift Path A to heal main before NO_CASH_SAFE
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
  v_safe uuid;
  v_shift uuid;
  v_expected numeric;
  v_diff numeric;
  v_vr text;
  v_amount numeric;
  v_kind public.shift_handover_kind;
  v_ref text;
  v_hid uuid;
  v_cashier text;
  v_transfer uuid;
  v_cd text;
  v_status public.shift_handover_status := 'pending';
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
    (restaurant_id, reference, shift_id, kind, amount, status, created_by, review_status)
  VALUES (v_rest, v_ref, v_shift, v_kind, v_amount, 'pending', v_actor, 'pending')
  RETURNING id INTO v_hid;

  IF v_kind = 'to_main' AND v_amount > 0 THEN
    v_safe := public.ensure_main_cash_treasury_id(v_rest);
    IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;
    PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = v_safe FOR UPDATE;
    IF public.treasury_balance(v_drawer) < v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

    v_cd := public.next_financial_ref(v_rest, 'cash_drop', 'CD');
    INSERT INTO public.treasury_transfers
      (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
       is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
    VALUES (v_rest, v_cd, v_shift, v_drawer, v_safe, v_amount,
       'Shift handover ' || v_ref,
       true, 'executed', v_actor, v_actor, now(), now(), true)
    RETURNING id INTO v_transfer;

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by,
       source_ref_type, source_ref_id)
    VALUES
      (v_rest, v_drawer, v_shift, -v_amount, 'transfer_out', v_transfer, v_ref, v_actor,
       'shift_handover', v_hid),
      (v_rest, v_safe, v_shift, v_amount, 'transfer_in', v_transfer, v_ref, v_actor,
       'shift_handover', v_hid);

    UPDATE public.shift_handovers
    SET status = 'executed', received_by = v_actor, received_at = now(), transfer_id = v_transfer
    WHERE id = v_hid;
    v_status := 'executed';

    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_hid, NULL,
      jsonb_build_object('kind', 'to_main', 'amount', v_amount, 'reference', v_ref,
        'transfer_id', v_transfer, 'auto_on_close', true));
  ELSIF v_kind = 'to_main' AND v_amount = 0 THEN
    UPDATE public.shift_handovers
    SET status = 'executed', received_by = v_actor, received_at = now()
    WHERE id = v_hid;
    v_status := 'executed';
  END IF;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_actor;

  PERFORM public.log_audit_event(v_rest, 'shift.closed', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash_count, 'difference', v_diff,
      'destination', p_destination, 'handover_id', v_hid, 'handover_ref', v_ref,
      'auto_executed', v_status = 'executed'));
  PERFORM public.log_audit_event(v_rest, 'handover.created', NULL, v_actor, 'shift_handover', v_hid, NULL,
    jsonb_build_object('kind', p_destination, 'amount', v_amount, 'reference', v_ref, 'shift_id', v_shift,
      'status', v_status));

  RETURN jsonb_build_object(
    'shift_id', v_shift, 'handover_id', v_hid, 'reference', v_ref,
    'kind', p_destination, 'amount', v_amount,
    'cashier_name', coalesce(v_cashier, ''), 'status', v_status,
    'review_status', 'pending',
    'auto_executed', v_status = 'executed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_main_cash_treasury_id(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
