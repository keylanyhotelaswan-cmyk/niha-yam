-- Hide cancelled orders from cashier operational hub by default.
-- Manager can list them via p_fulfillment_status = 'cancelled'.
-- On cancel: void kitchen tickets + print kitchen cancel notice when kitchen was involved.

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

CREATE OR REPLACE FUNCTION public.m5_enqueue_kitchen_cancel_notice(
  p_order_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_ref text;
  v_ord_ref text;
  v_body text;
  v_id uuid;
  v_pj uuid;
  v_printer_id uuid;
  v_bridge_id uuid;
  v_printer public.printers%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT reference INTO v_ord_ref FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kitchen_tickets kt WHERE kt.order_id = p_order_id
  ) THEN
    RETURN NULL;
  END IF;

  -- Void open kitchen tickets / lines
  UPDATE public.kitchen_ticket_lines
  SET status = 'cancelled'
  WHERE ticket_id IN (
    SELECT id FROM public.kitchen_tickets WHERE order_id = p_order_id
  )
  AND status <> 'cancelled';

  UPDATE public.kitchen_tickets
  SET status = 'cancelled'
  WHERE order_id = p_order_id
    AND status IS DISTINCT FROM 'cancelled';

  -- Cancel pending kitchen print jobs for this order
  UPDATE public.print_jobs
  SET
    status = 'cancelled',
    cancel_reason = coalesce(nullif(trim(p_reason), ''), 'order cancelled'),
    cancelled_by = v_actor,
    cancelled_at = now()
  WHERE order_id = p_order_id
    AND kind = 'kitchen'
    AND status IN ('pending', 'retry_wait', 'claimed');

  v_body := 'إلغاء طلب ' || coalesce(v_ord_ref, '') ||
    CASE WHEN nullif(trim(coalesce(p_reason, '')), '') IS NOT NULL
      THEN E'\nالسبب: ' || trim(p_reason)
      ELSE ''
    END ||
    E'\nلا تحضّر هذا الطلب.';

  v_ref := public.next_financial_ref(v_rest, 'ops_message', 'OM');
  INSERT INTO public.ops_messages (restaurant_id, reference, body, target_role, created_by)
  VALUES (v_rest, v_ref, v_body, 'kitchen', v_actor)
  RETURNING id INTO v_id;

  v_printer_id := public.m6_default_printer_for_role(v_rest, 'kitchen'::public.printer_role);
  IF v_printer_id IS NOT NULL THEN
    SELECT * INTO v_printer FROM public.printers WHERE id = v_printer_id AND is_active;
    IF FOUND THEN
      IF v_printer.bridge_id IS NOT NULL THEN
        SELECT id INTO v_bridge_id FROM public.print_bridges
        WHERE id = v_printer.bridge_id AND restaurant_id = v_rest AND is_active;
      END IF;
      IF v_bridge_id IS NULL THEN
        SELECT id INTO v_bridge_id FROM public.print_bridges
        WHERE restaurant_id = v_rest AND is_active
        ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
      END IF;
      IF v_bridge_id IS NOT NULL THEN
        v_payload := jsonb_build_object(
          'data_snapshot', jsonb_build_object(
            'document_type', 'ops_message',
            'title_ar', 'إلغاء طلب للمطبخ',
            'body', v_body,
            'target_role', 'kitchen',
            'reference', v_ref,
            'order_reference', v_ord_ref,
            'printed_at', now(),
            'currency_label', 'ج.م'
          ),
          'document_type', 'ops_message',
          'windows_printer_name', v_printer.address->>'windows_printer_name'
        );
        INSERT INTO public.print_jobs (
          restaurant_id, order_id, reference, kind, status, printer_id, bridge_id, payload
        ) VALUES (
          v_rest, p_order_id, public.next_financial_ref(v_rest, 'print_job', 'PJ'),
          'ops_message', 'pending', v_printer_id, v_bridge_id, v_payload
        ) RETURNING id INTO v_pj;
        UPDATE public.ops_messages SET print_job_id = v_pj WHERE id = v_id;
      END IF;
    END IF;
  END IF;

  PERFORM public.record_order_event(
    p_order_id, 'kitchen.sent', 'ops_message', v_id,
    jsonb_build_object('kind', 'cancel_notice', 'reference', v_ref)
  );

  RETURN v_id;
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
  v_kitchen_notice uuid;
  v_had_kitchen boolean := false;
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

  SELECT EXISTS (
    SELECT 1 FROM public.kitchen_tickets WHERE order_id = p_order_id
  ) INTO v_had_kitchen;

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
    'manager_override', coalesce((v_elig->>'manager_override')::boolean, false),
    'had_kitchen', v_had_kitchen
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

  IF v_had_kitchen THEN
    v_kitchen_notice := public.m5_enqueue_kitchen_cancel_notice(p_order_id, v_reason);
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'fulfillment_status', 'cancelled',
    'from', v_order.fulfillment_status::text,
    'reason', v_reason,
    'kitchen_notice_id', v_kitchen_notice
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m5_enqueue_kitchen_cancel_notice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- Daily POS search: keep cancelled out of cashier operational lookup.
CREATE OR REPLACE FUNCTION public.pos_search(p_query text, p_limit int DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_norm text;
  v_lim int := greatest(coalesce(p_limit, 15), 1);
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_q IS NULL THEN
    RETURN jsonb_build_object('orders', '[]'::jsonb, 'customers', '[]'::jsonb, 'menu_items', '[]'::jsonb);
  END IF;
  v_norm := public.normalize_phone(v_q);

  RETURN jsonb_build_object(
    'orders', coalesce((
      SELECT jsonb_agg(row ORDER BY created_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', o.id, 'reference', o.reference,
          'customer_name', coalesce(o.delivery_name, c.display_name),
          'payment_status', o.payment_status, 'order_type', o.order_type,
          'total', o.total, 'created_at', o.created_at
        ) AS row, o.created_at
        FROM public.orders o
        LEFT JOIN public.customers c ON c.id = o.customer_id
        WHERE o.restaurant_id = v_rest
          AND o.created_at >= current_date::timestamptz
          AND o.created_at < (current_date + 1)::timestamptz
          AND o.fulfillment_status <> 'cancelled'
          AND (
            o.reference ILIKE '%' || v_q || '%'
            OR o.delivery_phone ILIKE '%' || v_q || '%'
            OR o.delivery_name ILIKE '%' || v_q || '%'
            OR c.display_name ILIKE '%' || v_q || '%'
            OR EXISTS (
              SELECT 1 FROM public.customer_phones cp
              WHERE cp.customer_id = o.customer_id
                AND (v_norm IS NOT NULL AND cp.phone_normalized = v_norm)
            )
          )
        ORDER BY o.created_at DESC
        LIMIT v_lim
      ) sub
    ), '[]'::jsonb),
    'customers', public.search_customers(v_q, v_lim),
    'menu_items', coalesce((
      SELECT jsonb_agg(row ORDER BY name)
      FROM (
        SELECT jsonb_build_object(
          'id', mi.id, 'name', mi.name, 'sku', mi.sku, 'base_price', mi.base_price
        ) AS row, mi.name
        FROM public.menu_items mi
        WHERE mi.restaurant_id = v_rest AND mi.is_active = true AND mi.show_in_pos = true
          AND (mi.name ILIKE '%' || v_q || '%' OR mi.sku ILIKE '%' || v_q || '%')
        LIMIT v_lim
      ) sub
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_search(text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
