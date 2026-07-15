-- Soft cancel order with clear business rules + rich audit.
-- Takeaway auto-fulfillment=delivered must remain cancellable while unpaid.

CREATE OR REPLACE FUNCTION public.m5_order_cancel_eligibility(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_order public.orders%ROWTYPE;
  v_collected numeric := 0;
  v_is_manager boolean := public.is_owner_or_manager();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(sum(op.amount - coalesce(op.change_given, 0)), 0)
  INTO v_collected
  FROM public.order_payments op
  WHERE op.order_id = p_order_id
    AND op.collection_status IN ('pending', 'approved');

  IF v_order.fulfillment_status = 'cancelled' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'ALREADY_CANCELLED');
  END IF;

  IF v_collected > 0.001 THEN
    IF v_order.payment_status = 'partial' THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'CANCEL_BLOCKED_PARTIAL');
    END IF;
    RETURN jsonb_build_object('allowed', false, 'code', 'CANCEL_BLOCKED_COLLECTED');
  END IF;

  IF v_order.order_type = 'takeaway' THEN
    RETURN jsonb_build_object('allowed', true, 'code', null);
  END IF;

  IF v_order.fulfillment_status = 'delivered' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'CANCEL_BLOCKED_DELIVERED');
  END IF;

  IF v_order.fulfillment_status IN ('preparing', 'ready') THEN
    IF v_is_manager THEN
      RETURN jsonb_build_object('allowed', true, 'code', null, 'manager_override', true);
    END IF;
    RETURN jsonb_build_object('allowed', false, 'code', 'CANCEL_BLOCKED_IN_PROGRESS');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'code', null);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_elig jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_payload jsonb;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'CANCEL_REASON_REQUIRED'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_elig := public.m5_order_cancel_eligibility(p_order_id);
  IF NOT coalesce((v_elig->>'allowed')::boolean, false) THEN
    RAISE EXCEPTION '%', coalesce(v_elig->>'code', 'INVALID_STATE');
  END IF;

  UPDATE public.orders
  SET fulfillment_status = 'cancelled'
  WHERE id = p_order_id;

  v_payload := jsonb_build_object(
    'from', v_order.fulfillment_status::text,
    'to', 'cancelled',
    'reason', v_reason,
    'by', v_staff,
    'order_type', v_order.order_type::text,
    'payment_status_before', v_order.payment_status::text,
    'manager_override', coalesce((v_elig->>'manager_override')::boolean, false)
  );

  PERFORM public.record_order_event(
    p_order_id, 'order.cancelled', 'order', p_order_id, v_payload
  );

  PERFORM public.log_audit_event(
    v_rest, 'order.cancelled', NULL, v_staff, 'order', p_order_id, NULL,
    v_payload || jsonb_build_object(
      'fulfillment_before', v_order.fulfillment_status::text,
      'fulfillment_after', 'cancelled'
    )
  );

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'fulfillment_status', 'cancelled',
    'from', v_order.fulfillment_status::text,
    'reason', v_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.m5_order_cancel_eligibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
