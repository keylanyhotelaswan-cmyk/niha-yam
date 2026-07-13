-- M4 patch: stamp every ledger movement with its operation's reference, so the
-- ledger is fully self-describing (scenario 12). Movements still link
-- structurally via transfer_id / source_ref_id; reference is the human handle.

-- open_shift: opening-float movement carries the shift (SH) reference --------
CREATE OR REPLACE FUNCTION public.open_shift(p_opening_float numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_ref text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open') THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;
  IF coalesce(p_opening_float, 0) < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true;
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'shift', 'SH');
  INSERT INTO public.shifts (restaurant_id, reference, opened_by, status)
  VALUES (v_rest, v_ref, v_actor, 'open') RETURNING id INTO v_shift;

  IF coalesce(p_opening_float, 0) > 0 THEN
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, p_opening_float, 'opening_float', 'shift', v_shift, v_ref, v_actor);
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', coalesce(p_opening_float, 0), 'reference', v_ref));
  RETURN v_shift;
END; $$;

-- cash_drop: both legs carry the CD reference ------------------------------
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
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true;
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  SELECT id INTO v_safe FROM public.treasuries
  WHERE restaurant_id = v_rest AND type = 'cash' AND is_shift_drawer = false AND is_active = true
  ORDER BY sort_order LIMIT 1;
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
END; $$;

-- approve_transfer: legs carry the transfer (TR) reference -----------------
CREATE OR REPLACE FUNCTION public.approve_transfer(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_t public.treasury_transfers;
BEGIN
  SELECT * INTO v_t FROM public.treasury_transfers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
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
END; $$;

-- reverse_transfer: legs carry the reversal (TR/CD) reference --------------
CREATE OR REPLACE FUNCTION public.reverse_transfer(p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_t public.treasury_transfers; v_new uuid; v_ref text;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_t FROM public.treasury_transfers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF public.treasury_balance(v_t.dest_treasury_id) < v_t.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_ref := public.next_financial_ref(v_rest, CASE WHEN v_t.is_cash_drop THEN 'cash_drop' ELSE 'transfer' END,
    CASE WHEN v_t.is_cash_drop THEN 'CD' ELSE 'TR' END);
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     is_cash_drop, status, created_by, approved_by, approved_at, executed_at, reverses_id, auto_approved)
  VALUES (v_rest, v_ref, v_t.shift_id, v_t.dest_treasury_id, v_t.source_treasury_id, v_t.amount,
     'reversal of ' || v_t.reference, v_t.is_cash_drop, 'executed', public.auth_staff_id(),
     public.auth_staff_id(), now(), now(), p_id, true)
  RETURNING id INTO v_new;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', v_new, v_ref, public.auth_staff_id()),
    (v_rest, v_t.source_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', v_new, v_ref, public.auth_staff_id());

  UPDATE public.treasury_transfers
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(v_rest, 'transfer.reversed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('reason', trim(p_reason), 'reversal_ref', v_ref));
  RETURN v_new;
END; $$;

-- approve_expense / reverse_expense: movement carries EXP reference --------
CREATE OR REPLACE FUNCTION public.approve_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_e public.expenses;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF public.treasury_balance(v_e.treasury_id) < v_e.amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;
  UPDATE public.expenses
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now()
  WHERE id = p_id;
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_e.treasury_id, -v_e.amount, 'expense', 'expense', p_id, v_e.reference, public.auth_staff_id());
  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('amount', v_e.amount));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_expense(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_e public.expenses;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_e FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_e.treasury_id, v_e.amount, 'expense', 'expense_reversal', p_id, v_e.reference, public.auth_staff_id());
  UPDATE public.expenses
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'expense.reversed', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

-- approve_adjustment / reverse_adjustment: movement carries DEP/WD ref -----
CREATE OR REPLACE FUNCTION public.approve_adjustment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_a public.treasury_adjustments; v_amount numeric;
BEGIN
  SELECT * INTO v_a FROM public.treasury_adjustments WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_a.kind = 'withdrawal' AND public.treasury_balance(v_a.treasury_id) < v_a.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;
  v_amount := CASE WHEN v_a.kind = 'deposit' THEN v_a.amount ELSE -v_a.amount END;
  UPDATE public.treasury_adjustments
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now()
  WHERE id = p_id;
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment', p_id, v_a.reference, public.auth_staff_id());
  PERFORM public.log_audit_event(v_rest, 'adjustment.executed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('kind', v_a.kind, 'amount', v_a.amount));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_adjustment(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_a public.treasury_adjustments; v_amount numeric;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_a FROM public.treasury_adjustments WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  v_amount := CASE WHEN v_a.kind = 'deposit' THEN -v_a.amount ELSE v_a.amount END;
  IF v_amount < 0 AND public.treasury_balance(v_a.treasury_id) < v_a.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment_reversal', p_id, v_a.reference, public.auth_staff_id());
  UPDATE public.treasury_adjustments
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'adjustment.reversed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

NOTIFY pgrst, 'reload schema';
