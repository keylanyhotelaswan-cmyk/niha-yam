-- Cashier POS transfers: fund check uses operational balance (same as get_pos_context).
-- Approval/ledger remains for admin reports; cashier UX must not show 0 while operational cash exists.
-- Replaces least(ledger, operational) which zeroed available when approved_balance=0 and pending cash>0.

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
  v_available numeric;
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

  IF p_source_treasury_id::text < p_dest_treasury_id::text THEN
    PERFORM 1 FROM public.treasuries WHERE id = p_source_treasury_id FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = p_dest_treasury_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.treasuries WHERE id = p_dest_treasury_id FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = p_source_treasury_id FOR UPDATE;
  END IF;

  v_available := public.m5b_operational_treasury_balance(p_source_treasury_id, v_shift);
  IF v_available < p_amount THEN
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
    v_transfer, NULL, jsonb_build_object(
      'amount', p_amount,
      'reference', v_ref,
      'pos_operational', true,
      'available_before', v_available
    ));
  RETURN v_transfer;
END; $$;

NOTIFY pgrst, 'reload schema';
