-- Production Chaos reliability locks (no architecture change)
-- Fixes found by chaos audit: reject races, cash_drop race, transfer double-approve,
-- remote_operator cash RPC gate, edit vs approve TOCTOU.

-- =============================================================================
-- reject_collection: FOR UPDATE + pending-only update
-- =============================================================================
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
  IF v_op.collection_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  -- Serialize against edit_pending_order (order row lock)
  PERFORM 1 FROM public.orders WHERE id = v_op.order_id FOR UPDATE;

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
-- reject_expense: FOR UPDATE + pending-only update
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

-- =============================================================================
-- cash_drop: drawer lock + remote_operator gate
-- =============================================================================
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
  v_safe := public.main_cash_treasury_id(v_rest);
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

-- =============================================================================
-- approve_transfer: row lock + pending-only + treasury locks
-- =============================================================================
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
  SET status = 'executed', approved_by = public.auth_staff_id(), approved_at = now(), executed_at = now()
  WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, v_t.source_treasury_id, v_t.shift_id, -v_t.amount, 'transfer_out', p_id, v_t.reference, public.auth_staff_id()),
    (v_rest, v_t.dest_treasury_id, v_t.shift_id, v_t.amount, 'transfer_in', p_id, v_t.reference, public.auth_staff_id());

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, public.auth_staff_id(),
    'treasury_transfer', p_id, NULL, jsonb_build_object('amount', v_t.amount));
END;
$$;

-- =============================================================================
-- pos_record_expense: remote_operator gate + drawer lock
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
     status, created_by, auto_approved)
  VALUES (v_rest, v_ref, v_shift, v_drawer, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'pending', v_actor, false)
  RETURNING id INTO v_exp;

  PERFORM public.log_audit_event(v_rest, 'expense.created', NULL, v_actor, 'expense', v_exp, NULL,
    jsonb_build_object(
      'amount', p_amount, 'reference', v_ref, 'pos_operational', true, 'status', 'pending'
    ));
  RETURN v_exp;
END; $$;

-- =============================================================================
-- approve_collection: lock parent order (serialize vs edit)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.approve_collection(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_order_id uuid;
BEGIN
  SELECT op.order_id INTO v_order_id
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.id = p_id AND o.restaurant_id = v_rest;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Serialize vs edit_pending_order
  PERFORM 1 FROM public.orders WHERE id = v_order_id FOR UPDATE;

  PERFORM public.m5b_post_collection_ledger(p_id, public.auth_staff_id());
END; $$;
