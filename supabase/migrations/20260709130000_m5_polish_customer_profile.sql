-- M5 polish: richer customer profile (last visit / open order) — computed only

CREATE OR REPLACE FUNCTION public.get_customer_profile(
  p_customer_id uuid,
  p_orders_limit int DEFAULT 10
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'notes', c.notes,
      'phones', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cp.id, 'phone_raw', cp.phone_raw, 'label', cp.label, 'is_primary', cp.is_primary
        ) ORDER BY cp.is_primary DESC)
        FROM public.customer_phones cp WHERE cp.customer_id = c.id
      ), '[]'::jsonb),
      'addresses', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ca.id, 'label', ca.label, 'address_line', ca.address_line,
          'delivery_zone', ca.delivery_zone, 'is_default', ca.is_default
        ) ORDER BY ca.is_default DESC)
        FROM public.customer_addresses ca WHERE ca.customer_id = c.id
      ), '[]'::jsonb),
      'order_count', (
        SELECT count(*)::int FROM public.orders o
        WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
      ),
      'total_purchases', (
        SELECT coalesce(sum(o.total), 0) FROM public.orders o
        WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
      ),
      'last_order_at', (
        SELECT max(o.created_at) FROM public.orders o
        WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
      ),
      'open_order', (
        SELECT jsonb_build_object(
          'id', o.id, 'reference', o.reference, 'total', o.total,
          'payment_status', o.payment_status,
          'fulfillment_status', o.fulfillment_status,
          'created_at', o.created_at
        )
        FROM public.orders o
        WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
          AND o.fulfillment_status NOT IN ('delivered', 'cancelled')
        ORDER BY o.created_at DESC
        LIMIT 1
      ),
      'recent_orders', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'reference', o.reference, 'total', o.total,
          'payment_status', o.payment_status,
          'fulfillment_status', o.fulfillment_status,
          'created_at', o.created_at
        ) ORDER BY o.created_at DESC)
        FROM (
          SELECT o.id, o.reference, o.total, o.payment_status,
                 o.fulfillment_status, o.created_at
          FROM public.orders o
          WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
          ORDER BY o.created_at DESC
          LIMIT greatest(p_orders_limit, 1)
        ) o
      ), '[]'::jsonb)
    )
    FROM public.customers c WHERE c.id = p_customer_id
  );
END; $$;

NOTIFY pgrst, 'reload schema';
