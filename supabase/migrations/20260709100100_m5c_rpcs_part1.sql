-- M5C RPCs part 1: Collected axis, helpers, create unpaid, flag review, list/detail.

-- ---------------------------------------------------------------------------
-- Collected / Remaining helpers (ADR-0025 §1.2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m5c_order_collected_amount(p_order_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0)
  FROM public.order_payments
  WHERE order_id = p_order_id
    AND collection_status IN ('pending', 'approved');
$$;

CREATE OR REPLACE FUNCTION public.m5c_order_money_snapshot(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric;
  v_collected numeric;
  v_remaining numeric;
  v_status public.order_payment_status;
  v_pending_count int;
  v_approved_count int;
  v_has_approved boolean;
BEGIN
  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_collected := public.m5c_order_collected_amount(p_order_id);
  v_remaining := greatest(v_total - v_collected, 0);

  IF v_collected <= 0 THEN v_status := 'unpaid';
  ELSIF v_collected >= v_total THEN v_status := 'paid';
  ELSE v_status := 'partial';
  END IF;

  SELECT
    count(*) FILTER (WHERE collection_status = 'pending')::int,
    count(*) FILTER (WHERE collection_status = 'approved')::int
  INTO v_pending_count, v_approved_count
  FROM public.order_payments WHERE order_id = p_order_id;

  v_has_approved := v_approved_count > 0;

  RETURN jsonb_build_object(
    'order_total', v_total,
    'collected_amount', v_collected,
    'remaining_amount', v_remaining,
    'payment_status', v_status,
    'pending_collections_count', coalesce(v_pending_count, 0),
    'approved_collections_count', coalesce(v_approved_count, 0),
    'has_approved_collection', v_has_approved,
    'over_collected_amount', greatest(v_collected - v_total, 0)
  );
END; $$;

-- Customer axis: pending + approved (supersedes M5B approved-only)
CREATE OR REPLACE FUNCTION public.m5b_recalc_order_payment_status(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap jsonb := public.m5c_order_money_snapshot(p_order_id);
BEGIN
  IF v_snap IS NULL THEN RETURN; END IF;
  UPDATE public.orders
  SET payment_status = (v_snap->>'payment_status')::public.order_payment_status
  WHERE id = p_order_id;
END; $$;

CREATE OR REPLACE FUNCTION public.m5c_order_has_approved_collection(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_payments
    WHERE order_id = p_order_id AND collection_status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.m5c_order_has_any_collection(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_payments
    WHERE order_id = p_order_id
      AND collection_status IN ('pending', 'approved')
  );
$$;

-- Flag review + optional notification outbox
CREATE OR REPLACE FUNCTION public.m5c_flag_order_review(
  p_order_id uuid,
  p_reason text,
  p_financial_delta numeric DEFAULT NULL,
  p_actor uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid;
  v_actor uuid := coalesce(p_actor, public.auth_staff_id());
  v_ref text;
  v_notify boolean;
  v_providers jsonb;
  v_prov jsonb;
  v_channel text;
BEGIN
  SELECT restaurant_id, reference INTO v_rest, v_ref
  FROM public.orders WHERE id = p_order_id;
  IF v_rest IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  UPDATE public.orders
  SET requires_review = true,
      review_reason = coalesce(nullif(trim(p_reason), ''), review_reason, 'تم تعديل الطلب بعد تسجيل التحصيل')
  WHERE id = p_order_id;

  PERFORM public.record_order_event(
    p_order_id, 'order.review_flagged', 'order', p_order_id,
    jsonb_build_object(
      'reason', coalesce(nullif(trim(p_reason), ''), 'تم تعديل الطلب بعد تسجيل التحصيل'),
      'financial_delta', p_financial_delta
    ),
    v_actor
  );
  PERFORM public.log_audit_event(v_rest, 'order.review_flagged', NULL, v_actor, 'order', p_order_id, NULL,
    jsonb_build_object('reason', p_reason, 'financial_delta', p_financial_delta));

  SELECT notify_on_order_edit, providers INTO v_notify, v_providers
  FROM public.restaurant_notification_settings WHERE restaurant_id = v_rest;

  IF coalesce(v_notify, false) AND v_providers IS NOT NULL THEN
    FOR v_prov IN SELECT * FROM jsonb_array_elements(v_providers)
    LOOP
      IF coalesce((v_prov->>'enabled')::boolean, false) THEN
        v_channel := coalesce(v_prov->>'type', 'unknown');
        INSERT INTO public.notification_outbox (restaurant_id, channel, event_key, payload, status)
        VALUES (
          v_rest, v_channel, 'order.edited_after_collection',
          jsonb_build_object(
            'order_id', p_order_id,
            'order_reference', v_ref,
            'cashier_id', v_actor,
            'reason', p_reason,
            'financial_delta', p_financial_delta,
            'edited_at', now()
          ),
          'pending'
        );
      END IF;
    END LOOP;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.clear_order_review(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  UPDATE public.orders
  SET requires_review = false,
      reviewed_at = now(),
      reviewed_by = v_actor,
      review_reason = NULL
  WHERE id = p_order_id;

  PERFORM public.record_order_event(
    p_order_id, 'order.review_cleared', 'order', p_order_id,
    jsonb_build_object('cleared_by', v_actor), v_actor
  );
  PERFORM public.log_audit_event(v_rest, 'order.review_cleared', NULL, v_actor, 'order', p_order_id, NULL, NULL);
END; $$;

-- Human-readable timeline label helper (server-side for tests / API)
CREATE OR REPLACE FUNCTION public.m5c_timeline_label(p_event_type text, p_payload jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_event_type
    WHEN 'order.created' THEN 'تم إنشاء الطلب'
    WHEN 'collection.recorded' THEN 'تم تسجيل التحصيل'
    WHEN 'collection.approved' THEN 'تم اعتماد التحصيل'
    WHEN 'collection.rejected' THEN 'تم رفض التحصيل'
    WHEN 'collection.reversed' THEN 'تم عكس التحصيل'
    WHEN 'order.item_added' THEN
      'أُضيف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.item_removed' THEN
      'حُذف صنف' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.qty_changed' THEN
      'تغيرت الكمية' || coalesce(' لـ ' || (p_payload->>'item_name'), '')
        || coalesce(' من ' || (p_payload->>'from_qty') || ' إلى ' || (p_payload->>'to_qty'), '')
    WHEN 'order.modifiers_changed' THEN
      'تغيرت الإضافات' || coalesce(': ' || (p_payload->>'item_name'), '')
    WHEN 'order.customer_changed' THEN 'تغير العميل'
    WHEN 'order.tender_changed' THEN 'تغيرت طريقة الدفع'
    WHEN 'order.total_changed' THEN
      'تغير إجمالي الطلب من '
        || coalesce(p_payload->>'from_total', '?')
        || ' إلى '
        || coalesce(p_payload->>'to_total', '?')
    WHEN 'order.amended' THEN 'تم تعديل الطلب (رسمي)'
    WHEN 'order.review_flagged' THEN 'وُضعت علامة تحتاج مراجعة'
    WHEN 'order.review_cleared' THEN 'أُزيلت علامة المراجعة'
    WHEN 'kitchen.sent' THEN 'تم الإرسال للمطبخ'
    WHEN 'print.enqueued' THEN 'تم إرسال للطباعة'
    WHEN 'fulfillment.updated' THEN 'تحديث حالة التنفيذ'
    WHEN 'order.delivered' THEN 'تم التسليم'
    WHEN 'order.cancelled' THEN 'تم الإلغاء'
    ELSE p_event_type
  END;
END; $$;

-- Update record_order_event audit mapping for new types
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
    ELSE NULL
  END;
  IF v_audit_action IS NOT NULL THEN
    PERFORM public.log_audit_event(v_rest, v_audit_action, NULL, v_actor,
      coalesce(p_entity_type, 'order'), coalesce(p_entity_id, p_order_id), NULL, v_payload);
  END IF;
  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------------
-- create_unpaid_order (pay later — takeaway or delivery)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_unpaid_order(
  p_items jsonb,
  p_order_type public.pos_order_type DEFAULT 'takeaway',
  p_customer_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_order_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_ord_ref text;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_total numeric;
  v_line jsonb;
  v_item public.menu_items%ROWTYPE;
  v_unit numeric;
  v_line_total numeric;
  v_sort int := 0;
  v_has_kitchen boolean := false;
  v_kt_id uuid;
  v_kt_ref text;
  v_cust_id uuid := p_customer_id;
  v_cust_name text;
  v_cust_phone text;
  v_fulfillment public.order_fulfillment_status;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  IF p_order_type = 'dine_in' THEN RAISE EXCEPTION 'DINE_IN_NOT_ENABLED'; END IF;

  IF v_cust_id IS NULL AND p_customer_phone IS NOT NULL AND length(trim(p_customer_phone)) > 0 THEN
    v_cust_id := public.upsert_customer(
      coalesce(nullif(trim(p_customer_name), ''), 'عميل'),
      p_customer_phone, NULL, p_delivery_address, p_delivery_zone
    );
  END IF;
  IF v_cust_id IS NOT NULL THEN
    SELECT display_name INTO v_cust_name FROM public.customers WHERE id = v_cust_id;
    SELECT phone_raw INTO v_cust_phone FROM public.customer_phones
    WHERE customer_id = v_cust_id AND is_primary LIMIT 1;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid AND restaurant_id = v_rest
      AND is_active = true AND show_in_pos = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    IF v_unit IS NULL OR v_unit < 0 THEN RAISE EXCEPTION 'INVALID_OPEN_PRICE'; END IF;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := v_subtotal;

  v_fulfillment := CASE WHEN p_order_type = 'takeaway' THEN 'delivered'::public.order_fulfillment_status
                        ELSE 'new'::public.order_fulfillment_status END;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, order_type,
    payment_status, fulfillment_status, print_status,
    subtotal, discount_amount, total, order_note,
    customer_id, delivery_name, delivery_phone, delivery_address, delivery_zone, delivery_notes,
    created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', p_order_type,
    'unpaid', v_fulfillment, 'pending',
    v_subtotal, 0, v_total, nullif(trim(coalesce(p_order_note, '')), ''),
    v_cust_id,
    coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), v_cust_name),
    coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), v_cust_phone),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    nullif(trim(coalesce(p_delivery_zone, '')), ''),
    nullif(trim(coalesce(p_delivery_notes, '')), ''),
    v_staff, now()
  ) RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    IF v_item.needs_kitchen THEN v_has_kitchen := true; END IF;
    INSERT INTO public.order_items (
      order_id, menu_item_id, name, sku, unit_price, quantity, line_total,
      is_open_price, needs_kitchen, needs_print, line_note, sort_order
    ) VALUES (
      v_order_id, v_item.id, v_item.name, v_item.sku, v_unit,
      greatest((v_line->>'quantity')::int, 1), v_line_total,
      v_item.is_open_price, v_item.needs_kitchen, v_item.needs_print,
      nullif(trim(coalesce(v_line->>'note', '')), ''), v_sort
    );
    v_sort := v_sort + 1;
  END LOOP;

  IF v_has_kitchen THEN
    v_kt_ref := public.next_financial_ref(v_rest, 'kitchen_ticket', 'KT');
    INSERT INTO public.kitchen_tickets (restaurant_id, order_id, reference, shift_id, status)
    VALUES (v_rest, v_order_id, v_kt_ref, v_shift, 'new') RETURNING id INTO v_kt_id;
    INSERT INTO public.kitchen_ticket_lines (ticket_id, order_item_id, name, quantity, line_note, sort_order)
    SELECT v_kt_id, oi.id, oi.name, oi.quantity, oi.line_note, oi.sort_order
    FROM public.order_items oi WHERE oi.order_id = v_order_id AND oi.needs_kitchen;
    PERFORM public.record_order_event(v_order_id, 'kitchen.sent', 'kitchen_ticket', v_kt_id,
      jsonb_build_object('reference', v_kt_ref));
  END IF;

  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('reference', v_ord_ref, 'total', v_total, 'order_type', p_order_type::text, 'pay_later', true));

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ord_ref,
    'money', public.m5c_order_money_snapshot(v_order_id)
  );
END; $$;

NOTIFY pgrst, 'reload schema';
