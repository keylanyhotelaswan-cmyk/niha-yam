-- Expose reopen/review actor + timestamp on POS list and order detail.

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
  p_offset int DEFAULT 0,
  p_shift_id uuid DEFAULT NULL,
  p_hub_only boolean DEFAULT false
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
        'review_reason', o.review_reason,
        'review_flagged_at', CASE
          WHEN o.requires_review THEN (
            SELECT e.created_at FROM public.order_events e
            WHERE e.order_id = o.id
              AND e.event_type IN ('order.reopened', 'order.review_flagged')
            ORDER BY e.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'review_flagged_by_name', CASE
          WHEN o.requires_review THEN (
            SELECT st.display_name
            FROM public.order_events e
            LEFT JOIN public.staff st ON st.id = e.actor_id
            WHERE e.order_id = o.id
              AND e.event_type IN ('order.reopened', 'order.review_flagged')
            ORDER BY e.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'created_at', o.created_at,
        'created_by', o.created_by,
        'created_by_name', cr.display_name,
        'shift_id', o.shift_id,
        'customer_name', coalesce(o.delivery_name, c.display_name),
        'pending_collections', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'pending'
        ),
        'has_approved_collection', public.m5c_order_has_approved_collection(o.id),
        'cancel_reason', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT nullif(trim(coalesce(oe.payload->>'reason', '')), '')
            FROM public.order_events oe
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'cancelled_at', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT oe.created_at
            FROM public.order_events oe
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'cancelled_by_name', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT st.display_name
            FROM public.order_events oe
            LEFT JOIN public.staff st ON st.id = oe.actor_id
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'reversed_collections_count', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'reversed'
        ),
        'payment_breakdown', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'payment_method_id', pm.id,
            'code', pm.code,
            'name', pm.name,
            'amount', sub.amt
          ) ORDER BY pm.sort_order)
          FROM (
            SELECT op.payment_method_id,
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
      LEFT JOIN public.staff cr ON cr.id = o.created_by
      WHERE o.restaurant_id = v_rest
        AND (
          CASE
            WHEN p_shift_id IS NOT NULL THEN o.shift_id = p_shift_id
            ELSE o.created_at >= p_date::timestamptz
              AND o.created_at < (p_date + 1)::timestamptz
          END
        )
        AND (
          CASE
            WHEN p_fulfillment_status = 'cancelled' THEN
              o.fulfillment_status = 'cancelled'
            WHEN p_fulfillment_status IS NOT NULL THEN
              o.fulfillment_status::text = p_fulfillment_status
            ELSE
              o.fulfillment_status <> 'cancelled'
          END
        )
        AND (
          NOT p_hub_only
          OR o.payment_status IN ('unpaid', 'partial')
          OR o.requires_review = true
          OR o.fulfillment_status IN ('new', 'preparing', 'ready')
        )
        AND (p_payment_status IS NULL OR o.payment_status::text = p_payment_status)
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
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_detail(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_order public.orders%ROWTYPE;
  v_money jsonb;
  v_created_name text;
  v_edited_name text;
  v_collected_by uuid;
  v_collected_at timestamptz;
  v_collected_name text;
  v_driver_name text;
  v_cancel_reason text;
  v_cancelled_at timestamptz;
  v_cancelled_by_name text;
  v_review_flagged_at timestamptz;
  v_review_flagged_by_name text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_money := public.m5c_order_money_snapshot(p_order_id);
  SELECT display_name INTO v_created_name FROM public.staff WHERE id = v_order.created_by;
  SELECT display_name INTO v_edited_name FROM public.staff WHERE id = v_order.last_edited_by;
  SELECT op.created_by, op.created_at INTO v_collected_by, v_collected_at
  FROM public.order_payments op
  WHERE op.order_id = p_order_id AND op.collection_status IN ('pending', 'approved')
  ORDER BY op.created_at DESC LIMIT 1;
  SELECT display_name INTO v_collected_name FROM public.staff WHERE id = v_collected_by;
  SELECT display_name INTO v_driver_name FROM public.delivery_drivers WHERE id = v_order.delivery_driver_id;

  IF v_order.fulfillment_status = 'cancelled' THEN
    SELECT
      nullif(trim(coalesce(oe.payload->>'reason', '')), ''),
      oe.created_at,
      st.display_name
    INTO v_cancel_reason, v_cancelled_at, v_cancelled_by_name
    FROM public.order_events oe
    LEFT JOIN public.staff st ON st.id = oe.actor_id
    WHERE oe.order_id = p_order_id AND oe.event_type = 'order.cancelled'
    ORDER BY oe.created_at DESC
    LIMIT 1;
  END IF;

  IF v_order.requires_review THEN
    SELECT e.created_at, st.display_name
    INTO v_review_flagged_at, v_review_flagged_by_name
    FROM public.order_events e
    LEFT JOIN public.staff st ON st.id = e.actor_id
    WHERE e.order_id = p_order_id
      AND e.event_type IN ('order.reopened', 'order.review_flagged')
    ORDER BY e.created_at DESC
    LIMIT 1;
  END IF;

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
      'discount_type', v_order.discount_type,
      'discount_value', v_order.discount_value,
      'discount_reason', v_order.discount_reason,
      'total', v_order.total,
      'order_note', v_order.order_note,
      'customer_id', v_order.customer_id,
      'delivery_name', v_order.delivery_name,
      'delivery_phone', v_order.delivery_phone,
      'delivery_address', v_order.delivery_address,
      'delivery_zone', v_order.delivery_zone,
      'dine_in_table_ref', v_order.dine_in_table_ref,
      'delivery_driver_id', v_order.delivery_driver_id,
      'delivery_driver_name', v_driver_name,
      'created_by', v_order.created_by,
      'cashier_name', v_created_name,
      'created_by_name', v_created_name,
      'created_at', v_order.created_at,
      'last_edited_by', v_order.last_edited_by,
      'last_edited_by_name', v_edited_name,
      'last_edited_at', v_order.last_edited_at,
      'collected_by', v_collected_by,
      'collected_by_name', v_collected_name,
      'collected_at', v_collected_at,
      'shift_id', v_order.shift_id,
      'requires_review', v_order.requires_review,
      'review_reason', v_order.review_reason,
      'review_flagged_at', v_review_flagged_at,
      'review_flagged_by_name', v_review_flagged_by_name,
      'can_free_edit', NOT public.m5c_order_has_approved_collection(p_order_id),
      'cancel_reason', v_cancel_reason,
      'cancelled_at', v_cancelled_at,
      'cancelled_by_name', v_cancelled_by_name
    ),
    'money', v_money,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'name', oi.name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total,
        'menu_item_id', oi.menu_item_id,
        'line_note', oi.line_note,
        'is_open_price', oi.is_open_price
      ) ORDER BY oi.sort_order)
      FROM public.order_items oi WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'collections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id,
        'reference', op.reference,
        'amount', op.amount,
        'change_given', op.change_given,
        'net_amount', coalesce(op.net_amount, op.amount - coalesce(op.change_given, 0)),
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'payment_method_code', pm.code,
        'payment_method_name', pm.name,
        'created_at', op.created_at,
        'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason,
        'reversal_reason', op.reversal_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op
      JOIN public.payment_methods pm ON pm.id = op.payment_method_id
      WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
    'payment_breakdown', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'payment_method_id', x.payment_method_id,
        'code', x.code,
        'name', x.name,
        'amount', x.amount
      ))
      FROM (
        SELECT pm.id AS payment_method_id, pm.code, pm.name,
          round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount
        FROM public.order_payments op
        JOIN public.payment_methods pm ON pm.id = op.payment_method_id
        WHERE op.order_id = p_order_id
          AND op.collection_status IN ('pending', 'approved')
        GROUP BY pm.id, pm.code, pm.name
      ) x
    ), '[]'::jsonb),
    'timeline', public.get_order_timeline(p_order_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_detail(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
