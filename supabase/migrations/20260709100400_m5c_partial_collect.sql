-- M5C: allow partial record_collection (pay Remaining in installments).

CREATE OR REPLACE FUNCTION public.record_collection(
  p_order_id uuid,
  p_tenders jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_total numeric;
  v_paid_pending numeric;
  v_paid_approved numeric;
  v_remaining numeric;
  v_tender jsonb;
  v_pm public.payment_methods%ROWTYPE;
  v_tender_amt numeric;
  v_pay_ref text;
  v_pay_id uuid;
  v_net numeric;
  v_tender_change numeric;
  v_remaining_due numeric;
  v_cash_tender numeric;
  v_non_cash numeric;
  v_cash_required numeric;
  v_tender_sum numeric := 0;
  v_ids uuid[] := '{}';
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_pending
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'pending';
  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_approved
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'approved';
  v_remaining := v_total - v_paid_approved - v_paid_pending;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  v_remaining_due := v_remaining;
  v_cash_tender := 0;
  v_non_cash := 0;
  v_tender_sum := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    v_tender_amt := (v_tender->>'amount')::numeric;
    IF coalesce(v_tender_amt, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
    IF v_pm.code = 'cash' THEN v_cash_tender := v_cash_tender + v_tender_amt;
    ELSE
      IF v_tender_amt > v_remaining_due + 0.001 THEN RAISE EXCEPTION 'DIGITAL_OVERPAY'; END IF;
      v_non_cash := v_non_cash + v_tender_amt;
      v_remaining_due := v_remaining_due - v_tender_amt;
    END IF;
  END LOOP;

  -- Partial allowed: tenders may cover less than full remaining (ADR-0025 / M5C)
  IF v_tender_sum <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
  v_cash_required := least(v_remaining, v_non_cash + v_cash_tender) - v_non_cash;
  IF v_cash_required < 0 THEN v_cash_required := 0; END IF;
  IF v_cash_tender < v_cash_required THEN RAISE EXCEPTION 'UNDERPAID'; END IF;

  v_remaining_due := v_remaining;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods WHERE id = (v_tender->>'payment_method_id')::uuid;
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_change := 0;
    IF v_pm.code = 'cash' THEN
      v_net := least(v_tender_amt, v_remaining_due);
      v_tender_change := v_tender_amt - v_net;
      v_remaining_due := v_remaining_due - v_net;
    ELSE
      v_net := v_tender_amt;
      v_remaining_due := v_remaining_due - v_net;
    END IF;

    v_pay_ref := public.next_financial_ref(v_rest, 'payment', 'PAY');
    INSERT INTO public.order_payments (
      order_id, reference, payment_method_id, treasury_id, amount, change_given,
      shift_id, collection_status, net_amount, created_by
    ) VALUES (
      p_order_id, v_pay_ref, v_pm.id, v_pm.treasury_id, v_tender_amt, v_tender_change,
      v_shift, 'pending', v_net, v_staff
    ) RETURNING id INTO v_pay_id;

    v_ids := array_append(v_ids, v_pay_id);
    PERFORM public.record_order_event(p_order_id, 'collection.recorded', 'order_payment', v_pay_id,
      jsonb_build_object('reference', v_pay_ref, 'amount', v_tender_amt, 'net_amount', v_net));
  END LOOP;

  PERFORM public.m5b_recalc_order_payment_status(p_order_id);
  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));
END; $$;

NOTIFY pgrst, 'reload schema';
