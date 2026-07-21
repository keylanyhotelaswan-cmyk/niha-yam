-- Canonical definition of public.list_orders_for_pos
--
-- RULE (ADR-0036 money/ops cleanup):
-- - This file is the editable source of truth for the function body.
-- - Do NOT redefine list_orders_for_pos inside unrelated feature migrations.
-- - To change behavior: edit this file, then add a NEW migration that
--   CREATE OR REPLACE's the function with the same body (copy from here).
-- - Historical migrations that redefined this function stay immutable.
--
-- Applied by: 20260721150000_deprecate_approve_canonical_list_orders.sql
-- (Keep bodies in sync when editing.)

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
