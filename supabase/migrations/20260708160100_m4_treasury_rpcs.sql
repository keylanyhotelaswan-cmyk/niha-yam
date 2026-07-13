-- M4: Treasury RPCs. SECURITY DEFINER + fixed search_path; each RPC is one
-- atomic transaction. Balances are always computed; the ledger is insert-only.

-- Helpers ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_financial_ref(
  p_restaurant_id uuid, p_ref_type text, p_prefix text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO public.financial_ref_counters (restaurant_id, ref_type, current_value)
  VALUES (p_restaurant_id, p_ref_type, 1)
  ON CONFLICT (restaurant_id, ref_type)
  DO UPDATE SET current_value = public.financial_ref_counters.current_value + 1
  RETURNING current_value INTO v;
  RETURN p_prefix || '-' || lpad(v::text, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.treasury_balance(p_treasury_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount), 0)
  FROM public.treasury_movements
  WHERE treasury_id = p_treasury_id;
$$;

CREATE OR REPLACE FUNCTION public.m4_require_manager()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid;
BEGIN
  v_rest := public.auth_restaurant_id();
  IF v_rest IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  RETURN v_rest;
END; $$;

-- Treasuries: setup --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_treasury(
  p_name text, p_type public.treasury_type, p_sort_order int
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_id uuid;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  INSERT INTO public.treasuries (restaurant_id, name, type, sort_order)
  VALUES (v_rest, trim(p_name), p_type, coalesce(p_sort_order, 0))
  RETURNING id INTO v_id;
  PERFORM public.log_audit_event(v_rest, 'treasury.created', NULL, public.auth_staff_id(),
    'treasury', v_id, NULL, jsonb_build_object('name', trim(p_name), 'type', p_type));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_treasury(
  p_id uuid, p_name text, p_sort_order int
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  UPDATE public.treasuries SET name = trim(p_name), sort_order = coalesce(p_sort_order, 0)
  WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.log_audit_event(v_rest, 'treasury.updated', NULL, public.auth_staff_id(),
    'treasury', p_id, NULL, jsonb_build_object('name', trim(p_name)));
END; $$;

CREATE OR REPLACE FUNCTION public.set_treasury_status(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  -- Rule 5: cannot deactivate a treasury holding a non-zero balance.
  IF p_active = false AND public.treasury_balance(p_id) <> 0 THEN
    RAISE EXCEPTION 'TREASURY_NOT_EMPTY';
  END IF;
  UPDATE public.treasuries SET is_active = p_active WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'treasury.status_changed', NULL, public.auth_staff_id(),
    'treasury', p_id, NULL, jsonb_build_object('is_active', p_active));
END; $$;

-- Payment methods: mapping + status ---------------------------------------
CREATE OR REPLACE FUNCTION public.set_payment_method_mapping(p_id uuid, p_treasury_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  IF p_treasury_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.treasuries WHERE id = p_treasury_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  UPDATE public.payment_methods SET treasury_id = p_treasury_id
  WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.log_audit_event(v_rest, 'payment_method.mapping_changed', NULL, public.auth_staff_id(),
    'payment_method', p_id, NULL, jsonb_build_object('treasury_id', p_treasury_id));
END; $$;

CREATE OR REPLACE FUNCTION public.set_payment_method_status(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_treasury uuid;
BEGIN
  SELECT treasury_id INTO v_treasury FROM public.payment_methods
  WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- Rule 6: cannot deactivate a payment method still linked to a treasury.
  IF p_active = false AND v_treasury IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_LINKED';
  END IF;
  UPDATE public.payment_methods SET is_active = p_active WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'payment_method.status_changed', NULL, public.auth_staff_id(),
    'payment_method', p_id, NULL, jsonb_build_object('is_active', p_active));
END; $$;

-- Shifts -------------------------------------------------------------------
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
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, created_by)
    VALUES (v_rest, v_drawer, v_shift, p_opening_float, 'opening_float', 'shift', v_shift, v_actor);
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', coalesce(p_opening_float, 0), 'reference', v_ref));
  RETURN v_shift;
END; $$;

CREATE OR REPLACE FUNCTION public.close_shift(
  p_actual_cash_count numeric, p_difference_reason text, p_notes text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_expected numeric;
  v_diff numeric;
BEGIN
  IF coalesce(p_actual_cash_count, -1) < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true;

  v_expected := public.treasury_balance(v_drawer);
  v_diff := p_actual_cash_count - v_expected;

  IF v_diff <> 0 THEN
    IF length(trim(coalesce(p_difference_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'DIFFERENCE_REASON_REQUIRED';
    END IF;
    -- Variance movement keeps the ledger equal to the counted reality (auditable).
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_diff, 'variance', 'shift', v_shift, v_actor);
  END IF;

  UPDATE public.shifts
  SET status = 'closed', closed_by = v_actor, closed_at = now(),
      actual_cash_count = p_actual_cash_count,
      difference_reason = nullif(trim(coalesce(p_difference_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = v_shift;

  PERFORM public.log_audit_event(v_rest, 'shift.closed', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash_count, 'difference', v_diff));
END; $$;

-- Cash drop (cashier-allowed, auto-approved) ------------------------------
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

  -- Rule 1: no overdraft.
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
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, created_by)
  VALUES
    (v_rest, v_drawer, v_shift, -p_amount, 'transfer_out', v_transfer, v_actor),
    (v_rest, v_safe, v_shift, p_amount, 'transfer_in', v_transfer, v_actor);

  PERFORM public.log_audit_event(v_rest, 'cash_drop.executed', NULL, v_actor, 'treasury_transfer',
    v_transfer, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref));
  RETURN v_transfer;
END; $$;

-- Transfers (manager F1) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_transfer(
  p_source_treasury_id uuid, p_dest_treasury_id uuid, p_amount numeric, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_id uuid; v_ref text;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_source_treasury_id = p_dest_treasury_id THEN RAISE EXCEPTION 'SAME_TREASURY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_source_treasury_id AND restaurant_id = v_rest)
     OR NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_dest_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'transfer', 'TR');
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, source_treasury_id, dest_treasury_id, amount, reason, status, created_by)
  VALUES (v_rest, v_ref, p_source_treasury_id, p_dest_treasury_id, p_amount,
    nullif(trim(coalesce(p_reason, '')), ''), 'pending', public.auth_staff_id())
  RETURNING id INTO v_id;
  PERFORM public.log_audit_event(v_rest, 'transfer.created', NULL, public.auth_staff_id(),
    'treasury_transfer', v_id, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref));
  RETURN v_id;
END; $$;

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
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, created_by)
  VALUES
    (v_rest, v_t.source_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', p_id, public.auth_staff_id()),
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', p_id, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('amount', v_t.amount));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_transfer(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_status public.fin_status;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT status INTO v_status FROM public.treasury_transfers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.treasury_transfers
  SET status = 'rejected', rejected_by = public.auth_staff_id(), rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'transfer.rejected', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_transfer(p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_t public.treasury_transfers; v_new uuid; v_ref text;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_t FROM public.treasury_transfers WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_t.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  -- Reversal moves dest -> source; ensure dest can fund it (rule 1).
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
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, created_by)
  VALUES
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', v_new, public.auth_staff_id()),
    (v_rest, v_t.source_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', v_new, public.auth_staff_id());

  UPDATE public.treasury_transfers
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(v_rest, 'transfer.reversed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('reason', trim(p_reason), 'reversal_ref', v_ref));
  RETURN v_new;
END; $$;

-- Expenses (manager F1; petty cash is a category) -------------------------
CREATE OR REPLACE FUNCTION public.create_expense(
  p_treasury_id uuid, p_category public.expense_category, p_amount numeric,
  p_description text, p_vendor text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_id uuid; v_ref text;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_ref := public.next_financial_ref(v_rest, 'expense', 'EXP');
  INSERT INTO public.expenses
    (restaurant_id, reference, treasury_id, category, amount, description, vendor, status, created_by)
  VALUES (v_rest, v_ref, p_treasury_id, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'pending', public.auth_staff_id())
  RETURNING id INTO v_id;
  PERFORM public.log_audit_event(v_rest, 'expense.created', NULL, public.auth_staff_id(),
    'expense', v_id, NULL, jsonb_build_object('amount', p_amount, 'category', p_category, 'reference', v_ref));
  RETURN v_id;
END; $$;

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
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, created_by)
  VALUES (v_rest, v_e.treasury_id, -v_e.amount, 'expense', 'expense', p_id, public.auth_staff_id());
  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('amount', v_e.amount));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_expense(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_status public.fin_status;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT status INTO v_status FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.expenses
  SET status = 'rejected', rejected_by = public.auth_staff_id(), rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'expense.rejected', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_expense(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_e public.expenses;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_e FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  -- Reversal credits the money back to the treasury.
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, created_by)
  VALUES (v_rest, v_e.treasury_id, v_e.amount, 'expense', 'expense_reversal', p_id, public.auth_staff_id());
  UPDATE public.expenses
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'expense.reversed', NULL, public.auth_staff_id(),
    'expense', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

-- Adjustments: deposit / withdrawal (manager F1) --------------------------
CREATE OR REPLACE FUNCTION public.create_adjustment(
  p_treasury_id uuid, p_kind text, p_amount numeric, p_reason text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_id uuid; v_ref text;
BEGIN
  IF p_kind NOT IN ('deposit', 'withdrawal') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE id = p_treasury_id AND restaurant_id = v_rest)
  THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_ref := public.next_financial_ref(v_rest, p_kind, CASE WHEN p_kind = 'deposit' THEN 'DEP' ELSE 'WD' END);
  INSERT INTO public.treasury_adjustments
    (restaurant_id, reference, treasury_id, kind, amount, reason, status, created_by)
  VALUES (v_rest, v_ref, p_treasury_id, p_kind, p_amount, nullif(trim(coalesce(p_reason, '')), ''),
    'pending', public.auth_staff_id())
  RETURNING id INTO v_id;
  PERFORM public.log_audit_event(v_rest, 'adjustment.created', NULL, public.auth_staff_id(),
    'treasury_adjustment', v_id, NULL, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'reference', v_ref));
  RETURN v_id;
END; $$;

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
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment', p_id, public.auth_staff_id());
  PERFORM public.log_audit_event(v_rest, 'adjustment.executed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('kind', v_a.kind, 'amount', v_a.amount));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_adjustment(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_status public.fin_status;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT status INTO v_status FROM public.treasury_adjustments WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.treasury_adjustments
  SET status = 'rejected', rejected_by = public.auth_staff_id(), rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'adjustment.rejected', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_adjustment(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_a public.treasury_adjustments; v_amount numeric;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_a FROM public.treasury_adjustments WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  -- Opposite of the original posting.
  v_amount := CASE WHEN v_a.kind = 'deposit' THEN -v_a.amount ELSE v_a.amount END;
  IF v_amount < 0 AND public.treasury_balance(v_a.treasury_id) < v_a.amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;
  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, amount, source, source_ref_type, source_ref_id, created_by)
  VALUES (v_rest, v_a.treasury_id, v_amount, v_a.kind::public.movement_source, 'adjustment_reversal', p_id, public.auth_staff_id());
  UPDATE public.treasury_adjustments
  SET status = 'reversed', reversed_by = public.auth_staff_id(), reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;
  PERFORM public.log_audit_event(v_rest, 'adjustment.reversed', NULL, public.auth_staff_id(),
    'treasury_adjustment', p_id, NULL, jsonb_build_object('reason', trim(p_reason)));
END; $$;

-- Reads: balances + reports (rule 7 — all computed, no summary tables) ----
CREATE OR REPLACE FUNCTION public.get_treasury_balances()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'name', t.name, 'type', t.type,
        'is_shift_drawer', t.is_shift_drawer, 'is_active', t.is_active,
        'sort_order', t.sort_order,
        'balance', coalesce(m.bal, 0),
        'total_in', coalesce(m.tin, 0),
        'total_out', coalesce(m.tout, 0),
        'movement_count', coalesce(m.cnt, 0)
      ) ORDER BY t.sort_order, t.name
    )
    FROM public.treasuries t
    LEFT JOIN LATERAL (
      SELECT sum(amount) AS bal,
             sum(amount) FILTER (WHERE amount > 0) AS tin,
             -sum(amount) FILTER (WHERE amount < 0) AS tout,
             count(*) AS cnt
      FROM public.treasury_movements mv WHERE mv.treasury_id = t.id
    ) m ON true
    WHERE t.restaurant_id = v_rest
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_treasury_ledger(p_treasury_id uuid, p_limit int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(entry ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', mv.id, 'amount', mv.amount, 'source', mv.source,
        'created_at', mv.created_at, 'created_by', s.display_name
      ) AS entry, mv.created_at
      FROM public.treasury_movements mv
      LEFT JOIN public.staff s ON s.id = mv.created_by
      WHERE mv.treasury_id = p_treasury_id AND mv.restaurant_id = v_rest
      ORDER BY mv.created_at DESC
      LIMIT coalesce(p_limit, 100)
    ) sub
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_open_shift()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift public.shifts;
  v_drawer uuid;
  v_opening numeric;
  v_expected numeric;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_drawer FROM public.treasuries WHERE restaurant_id = v_rest AND is_shift_drawer = true;
  SELECT coalesce(sum(amount), 0) INTO v_opening FROM public.treasury_movements
    WHERE shift_id = v_shift.id AND source = 'opening_float';
  v_expected := public.treasury_balance(v_drawer);

  RETURN jsonb_build_object(
    'id', v_shift.id, 'reference', v_shift.reference,
    'opened_at', v_shift.opened_at, 'opened_by', v_shift.opened_by,
    'opening_float', v_opening, 'expected_cash', v_expected
  );
END; $$;

-- Grants -------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.create_treasury(text, public.treasury_type, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_treasury(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_treasury_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_method_mapping(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_method_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_shift(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_shift(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_drop(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_transfer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense(uuid, public.expense_category, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_expense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_expense(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_expense(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_adjustment(uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_adjustment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_adjustment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_ledger(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_shift() TO authenticated;

NOTIFY pgrst, 'reload schema';
