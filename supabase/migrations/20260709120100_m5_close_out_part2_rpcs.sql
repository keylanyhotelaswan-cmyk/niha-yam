-- M5 Close-Out Part 2: Customer + driver RPCs, pos_search, timeline labels

-- ---------------------------------------------------------------------------
-- Customer search / profile (computed — no summary tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_customers(p_query text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_norm text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_q IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_norm := public.normalize_phone(v_q);

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY display_name)
    FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'display_name', c.display_name,
        'primary_phone', (
          SELECT cp.phone_raw FROM public.customer_phones cp
          WHERE cp.customer_id = c.id AND cp.is_primary LIMIT 1
        ),
        'order_count', (
          SELECT count(*)::int FROM public.orders o
          WHERE o.customer_id = c.id AND o.restaurant_id = v_rest
        )
      ) AS row, c.display_name
      FROM public.customers c
      WHERE c.restaurant_id = v_rest
        AND (
          c.display_name ILIKE '%' || v_q || '%'
          OR EXISTS (
            SELECT 1 FROM public.customer_phones cp
            WHERE cp.customer_id = c.id
              AND (cp.phone_raw ILIKE '%' || v_q || '%'
                OR (v_norm IS NOT NULL AND cp.phone_normalized = v_norm))
          )
        )
      LIMIT greatest(p_limit, 1)
    ) sub
  ), '[]'::jsonb);
END; $$;

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
      'recent_orders', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'reference', o.reference, 'total', o.total,
          'payment_status', o.payment_status, 'created_at', o.created_at
        ) ORDER BY o.created_at DESC)
        FROM (
          SELECT o.id, o.reference, o.total, o.payment_status, o.created_at
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

CREATE OR REPLACE FUNCTION public.list_frequent_customers(p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY order_count DESC, total_purchases DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', c.id,
        'display_name', c.display_name,
        'primary_phone', (
          SELECT cp.phone_raw FROM public.customer_phones cp
          WHERE cp.customer_id = c.id AND cp.is_primary LIMIT 1
        ),
        'order_count', stats.cnt,
        'total_purchases', stats.total_amt
      ) AS row, stats.cnt AS order_count, stats.total_amt AS total_purchases
      FROM (
        SELECT o.customer_id, count(*)::int AS cnt, coalesce(sum(o.total), 0) AS total_amt
        FROM public.orders o
        WHERE o.restaurant_id = v_rest AND o.customer_id IS NOT NULL
        GROUP BY o.customer_id
        ORDER BY cnt DESC, total_amt DESC
        LIMIT greatest(p_limit, 1)
      ) stats
      JOIN public.customers c ON c.id = stats.customer_id
    ) sub
  ), '[]'::jsonb);
END; $$;

-- ---------------------------------------------------------------------------
-- Delivery drivers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_delivery_drivers(p_active_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'display_name', d.display_name, 'phone', d.phone,
      'is_active', d.is_active, 'notes', d.notes
    ) ORDER BY d.display_name)
    FROM public.delivery_drivers d
    WHERE d.restaurant_id = v_rest
      AND (NOT p_active_only OR d.is_active = true)
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_delivery_driver(
  p_id uuid DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_id uuid;
BEGIN
  IF length(trim(coalesce(p_display_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.delivery_drivers
    SET display_name = trim(p_display_name),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        is_active = coalesce(p_is_active, true),
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    PERFORM public.log_audit_event(v_rest, 'delivery_driver.updated', NULL, v_staff,
      'delivery_driver', v_id, NULL, NULL);
  ELSE
    INSERT INTO public.delivery_drivers (restaurant_id, display_name, phone, is_active, notes)
    VALUES (v_rest, trim(p_display_name), nullif(trim(coalesce(p_phone, '')), ''),
      coalesce(p_is_active, true), nullif(trim(coalesce(p_notes, '')), ''))
    RETURNING id INTO v_id;
    PERFORM public.log_audit_event(v_rest, 'delivery_driver.created', NULL, v_staff,
      'delivery_driver', v_id, NULL, NULL);
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.assign_delivery_driver(
  p_order_id uuid,
  p_driver_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_old_id uuid;
  v_old_name text;
  v_new_name text;
  v_event text;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_order FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_order.order_type <> 'delivery' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_order.fulfillment_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  v_old_id := v_order.delivery_driver_id;
  IF v_old_id IS NOT NULL THEN
    SELECT display_name INTO v_old_name FROM public.delivery_drivers WHERE id = v_old_id;
  END IF;

  IF p_driver_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_drivers
      WHERE id = p_driver_id AND restaurant_id = v_rest AND is_active = true
    ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT display_name INTO v_new_name FROM public.delivery_drivers WHERE id = p_driver_id;
  END IF;

  IF v_old_id IS NOT DISTINCT FROM p_driver_id THEN RETURN; END IF;

  UPDATE public.orders SET delivery_driver_id = p_driver_id WHERE id = p_order_id;

  v_event := CASE WHEN v_old_id IS NULL THEN 'delivery.driver_assigned' ELSE 'delivery.driver_changed' END;

  PERFORM public.record_order_event(
    p_order_id, v_event, 'delivery_driver', p_driver_id,
    jsonb_build_object(
      'from_driver_id', v_old_id,
      'from_driver_name', v_old_name,
      'to_driver_id', p_driver_id,
      'to_driver_name', v_new_name,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    ),
    v_staff
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Unified POS search
-- ---------------------------------------------------------------------------
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
END; $$;

-- Timeline labels for driver events
CREATE OR REPLACE FUNCTION public.m5c_timeline_label(p_event_type text, p_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_event_type
    WHEN 'order.created' THEN 'تم إنشاء الطلب'
    WHEN 'collection.recorded' THEN 'تم التحصيل'
    WHEN 'collection.approved' THEN 'تم اعتماد التحصيل'
    WHEN 'collection.rejected' THEN 'تم رفض التحصيل'
    WHEN 'collection.reversed' THEN 'تم عكس التحصيل'
    WHEN 'order.item_added' THEN 'أُضيف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.item_removed' THEN 'حُذف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.qty_changed' THEN 'تغيرت الكمية' || coalesce(' لـ ' || (p_payload->>'item_name'), '')
    WHEN 'order.modifiers_changed' THEN 'تغيرت الإضافات' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.customer_changed' THEN 'تغير العميل'
    WHEN 'order.tender_changed' THEN 'تغيرت طريقة الدفع'
    WHEN 'order.total_changed' THEN 'تغير إجمالي الطلب'
    WHEN 'order.amended' THEN 'تم تعديل الطلب (رسمي)'
    WHEN 'order.review_flagged' THEN 'وُضعت علامة تحتاج مراجعة'
    WHEN 'order.review_cleared' THEN 'أُزيلت علامة المراجعة'
    WHEN 'kitchen.sent' THEN 'تم الإرسال للمطبخ'
    WHEN 'print.enqueued' THEN 'تم إرسال للطباعة'
    WHEN 'fulfillment.updated' THEN 'تحديث حالة التنفيذ'
    WHEN 'order.delivered' THEN 'تم التسليم'
    WHEN 'order.cancelled' THEN 'تم الإلغاء'
    WHEN 'delivery.driver_assigned' THEN
      'تم تعيين الكابتن' || coalesce(' ' || (p_payload->>'to_driver_name'), '')
    WHEN 'delivery.driver_changed' THEN
      'تم تغيير الكابتن من '
        || coalesce(p_payload->>'from_driver_name', '—')
        || ' إلى '
        || coalesce(p_payload->>'to_driver_name', '—')
    ELSE p_event_type
  END;
END; $$;

-- Patch record_order_event audit for driver events
CREATE OR REPLACE FUNCTION public.record_order_event(
  p_order_id uuid,
  p_event_type text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid;
  v_actor uuid := coalesce(p_actor_id, public.auth_staff_id());
  v_id uuid;
  v_audit_action text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  SELECT restaurant_id INTO v_rest FROM public.orders WHERE id = p_order_id;
  IF v_rest IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_payload := v_payload || jsonb_build_object(
    'label_ar', public.m5c_timeline_label(p_event_type, v_payload)
  );

  INSERT INTO public.order_events (
    restaurant_id, order_id, event_type, actor_id, entity_type, entity_id, payload
  ) VALUES (
    v_rest, p_order_id, p_event_type, v_actor, p_entity_type, p_entity_id, v_payload
  ) RETURNING id INTO v_id;

  v_audit_action := CASE p_event_type
    WHEN 'order.created' THEN 'order.created'
    WHEN 'collection.recorded' THEN 'order.collection_recorded'
    WHEN 'collection.approved' THEN 'order.collection_approved'
    WHEN 'collection.rejected' THEN 'order.collection_rejected'
    WHEN 'collection.reversed' THEN 'order.collection_reversed'
    WHEN 'order.amended' THEN 'order.amended'
    WHEN 'order.item_added' THEN 'order.edited'
    WHEN 'order.item_removed' THEN 'order.edited'
    WHEN 'order.qty_changed' THEN 'order.edited'
    WHEN 'order.modifiers_changed' THEN 'order.edited'
    WHEN 'order.customer_changed' THEN 'order.edited'
    WHEN 'order.tender_changed' THEN 'order.edited'
    WHEN 'order.total_changed' THEN 'order.edited'
    WHEN 'order.review_flagged' THEN 'order.review_flagged'
    WHEN 'order.review_cleared' THEN 'order.review_cleared'
    WHEN 'kitchen.sent' THEN 'kitchen.ticket_created'
    WHEN 'print.enqueued' THEN 'print.job_enqueued'
    WHEN 'fulfillment.updated' THEN 'order.fulfillment_updated'
    WHEN 'order.delivered' THEN 'order.fulfillment_updated'
    WHEN 'order.cancelled' THEN 'order.cancelled'
    WHEN 'delivery.driver_assigned' THEN 'order.driver_assigned'
    WHEN 'delivery.driver_changed' THEN 'order.driver_changed'
    ELSE NULL
  END;
  IF v_audit_action IS NOT NULL THEN
    PERFORM public.log_audit_event(v_rest, v_audit_action, NULL, v_actor,
      coalesce(p_entity_type, 'order'), coalesce(p_entity_id, p_order_id), NULL, v_payload);
  END IF;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.search_customers(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_profile(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_frequent_customers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_delivery_drivers(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_driver(uuid, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_delivery_driver(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_search(text, int) TO authenticated;
