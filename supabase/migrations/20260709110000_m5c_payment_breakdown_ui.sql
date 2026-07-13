-- M5C UI: expose payment method names/codes on order list + detail
-- No schema change — enrich RPC JSON only.

CREATE OR REPLACE FUNCTION public.list_orders_for_pos(
  p_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT NULL,
  p_fulfillment_status text DEFAULT NULL,
  p_order_type text DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_pending_collections_only boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_search text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_search := nullif(trim(coalesce(p_search, '')), '');

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'order_type', o.order_type,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'print_status', o.print_status,
        'total', o.total,
        'order_total', o.total,
        'collected_amount', public.m5c_order_collected_amount(o.id),
        'remaining_amount', greatest(o.total - public.m5c_order_collected_amount(o.id), 0),
        'requires_review', o.requires_review,
        'created_at', o.created_at,
        'created_by', o.created_by,
        'customer_name', coalesce(o.delivery_name, c.display_name),
        'pending_collections', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'pending'
        ),
        'has_approved_collection', public.m5c_order_has_approved_collection(o.id),
        'payment_breakdown', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'payment_method_id', pm.id,
            'code', pm.code,
            'name', pm.name,
            'amount', sub.amt
          ) ORDER BY pm.sort_order)
          FROM (
            SELECT
              op.payment_method_id,
              round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amt
            FROM public.order_payments op
            WHERE op.order_id = o.id
              AND op.collection_status IN ('pending', 'approved')
            GROUP BY op.payment_method_id
          ) sub
          JOIN public.payment_methods pm ON pm.id = sub.payment_method_id
        ), '[]'::jsonb)
      ) AS row, o.created_at
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
      WHERE o.restaurant_id = v_rest
        AND o.created_at >= p_date::timestamptz
        AND o.created_at < (p_date + 1)::timestamptz
        AND (p_payment_status IS NULL OR o.payment_status::text = p_payment_status)
        AND (p_fulfillment_status IS NULL OR o.fulfillment_status::text = p_fulfillment_status)
        AND (p_order_type IS NULL OR o.order_type::text = p_order_type)
        AND (p_cashier_id IS NULL OR o.created_by = p_cashier_id)
        AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
        AND (
          p_pending_collections_only = false OR EXISTS (
            SELECT 1 FROM public.order_payments op
            WHERE op.order_id = o.id AND op.collection_status = 'pending'
          )
        )
        AND (
          v_search IS NULL
          OR o.reference ILIKE '%' || v_search || '%'
          OR o.delivery_phone ILIKE '%' || v_search || '%'
          OR o.delivery_name ILIKE '%' || v_search || '%'
          OR c.display_name ILIKE '%' || v_search || '%'
          OR EXISTS (
            SELECT 1 FROM public.customer_phones cp
            WHERE cp.customer_id = o.customer_id
              AND cp.phone_normalized LIKE '%' || public.normalize_phone(v_search) || '%'
          )
        )
      ORDER BY o.created_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_order_detail(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_order public.orders%ROWTYPE;
  v_money jsonb;
  v_cashier_name text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_money := public.m5c_order_money_snapshot(p_order_id);
  SELECT display_name INTO v_cashier_name FROM public.staff WHERE id = v_order.created_by;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'order_type', v_order.order_type,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'print_status', v_order.print_status,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount_amount', v_order.discount_amount,
      'total', v_order.total,
      'order_note', v_order.order_note,
      'customer_id', v_order.customer_id,
      'delivery_name', v_order.delivery_name,
      'delivery_phone', v_order.delivery_phone,
      'delivery_address', v_order.delivery_address,
      'delivery_zone', v_order.delivery_zone,
      'created_by', v_order.created_by,
      'cashier_name', v_cashier_name,
      'created_at', v_order.created_at,
      'requires_review', v_order.requires_review,
      'review_reason', v_order.review_reason,
      'can_free_edit', NOT public.m5c_order_has_approved_collection(p_order_id)
    ),
    'money', v_money,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total, 'line_note', oi.line_note,
        'menu_item_id', oi.menu_item_id
      ) ORDER BY oi.sort_order)
      FROM public.order_items oi WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'collections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id,
        'reference', op.reference,
        'amount', op.amount,
        'change_given', op.change_given,
        'net_amount', op.net_amount,
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'payment_method_code', pm.code,
        'payment_method_name', pm.name,
        'created_at', op.created_at,
        'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op
      JOIN public.payment_methods pm ON pm.id = op.payment_method_id
      WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
    'payment_breakdown', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'payment_method_id', pm.id,
        'code', pm.code,
        'name', pm.name,
        'amount', sub.amt
      ) ORDER BY pm.sort_order)
      FROM (
        SELECT
          op.payment_method_id,
          round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amt
        FROM public.order_payments op
        WHERE op.order_id = p_order_id
          AND op.collection_status IN ('pending', 'approved')
        GROUP BY op.payment_method_id
      ) sub
      JOIN public.payment_methods pm ON pm.id = sub.payment_method_id
    ), '[]'::jsonb),
    'timeline', public.get_order_timeline(p_order_id)
  );
END; $$;
