-- Hard-block payments on cancelled orders (trigger + edit path).
-- Reopen paid order → requires_review → append items → collect delta only.

-- ---------------------------------------------------------------------------
-- 1) Event / audit allowlists
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_events DROP CONSTRAINT IF EXISTS chk_order_events_type;
ALTER TABLE public.order_events ADD CONSTRAINT chk_order_events_type CHECK (
  event_type IN (
    'order.created',
    'collection.recorded', 'collection.approved', 'collection.rejected', 'collection.reversed',
    'order.amended', 'order.reopened', 'order.items_appended',
    'order.item_added', 'order.item_removed', 'order.qty_changed', 'order.modifiers_changed',
    'order.customer_changed', 'order.tender_changed', 'order.total_changed',
    'order.review_flagged', 'order.review_cleared',
    'kitchen.sent', 'print.enqueued', 'print.skipped',
    'fulfillment.updated', 'order.delivered', 'order.cancelled',
    'delivery.driver_assigned', 'delivery.driver_changed'
  )
);

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
    WHEN 'order.reopened' THEN 'أُعيد فتح الطلب للمراجعة'
    WHEN 'order.items_appended' THEN 'أُضيفت أصناف بعد إعادة الفتح'
    WHEN 'order.review_flagged' THEN 'وُضعت علامة تحتاج مراجعة'
    WHEN 'order.review_cleared' THEN 'أُزيلت علامة المراجعة'
    WHEN 'kitchen.sent' THEN 'تم الإرسال للمطبخ'
    WHEN 'print.enqueued' THEN 'تم إرسال للطباعة'
    WHEN 'print.skipped' THEN coalesce('تخطّي طباعة: ' || (p_payload->>'reason'), 'تخطّي طباعة')
    WHEN 'fulfillment.updated' THEN 'تحديث التنفيذ'
    WHEN 'order.delivered' THEN 'تم التسليم'
    WHEN 'order.cancelled' THEN 'تم الإلغاء'
    WHEN 'delivery.driver_assigned' THEN 'تعيين مندوب'
    WHEN 'delivery.driver_changed' THEN 'تغيير المندوب'
    ELSE p_event_type
  END;
END;
$$;

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
    WHEN 'order.reopened' THEN 'order.review_flagged'
    WHEN 'order.items_appended' THEN 'order.edited'
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
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Hard block: BEFORE INSERT on order_payments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_block_payment_on_cancelled_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.order_fulfillment_status;
BEGIN
  SELECT fulfillment_status INTO v_status
  FROM public.orders
  WHERE id = NEW.order_id;
  IF FOUND AND v_status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payment_on_cancelled_order ON public.order_payments;
CREATE TRIGGER trg_block_payment_on_cancelled_order
  BEFORE INSERT ON public.order_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_payment_on_cancelled_order();

-- ---------------------------------------------------------------------------
-- 3) reopen_order + append_order_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_order(p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_order.fulfillment_status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED';
  END IF;

  IF NOT public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'REOPEN_REQUIRES_APPROVED_COLLECTION';
  END IF;

  IF v_order.requires_review THEN
    RAISE EXCEPTION 'ALREADY_IN_REVIEW';
  END IF;

  PERFORM public.m5c_flag_order_review(p_order_id, v_reason, 0, v_staff);

  PERFORM public.record_order_event(
    p_order_id, 'order.reopened', 'order', p_order_id,
    jsonb_build_object('reason', v_reason),
    v_staff
  );

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'requires_review', true,
    'review_reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.append_order_items(p_order_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_line jsonb;
  v_item public.menu_items%ROWTYPE;
  v_unit numeric;
  v_line_total numeric;
  v_sort int;
  v_oi_id uuid;
  v_old_total numeric;
  v_new_subtotal numeric := 0;
  v_new_total numeric;
  v_delta numeric;
  v_added int := 0;
  v_opt_id uuid;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_order.fulfillment_status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED';
  END IF;
  IF NOT v_order.requires_review THEN
    RAISE EXCEPTION 'REOPEN_REQUIRED';
  END IF;
  IF NOT public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'REOPEN_REQUIRES_APPROVED_COLLECTION';
  END IF;

  v_old_total := v_order.total;
  SELECT coalesce(max(sort_order), -1) + 1 INTO v_sort
  FROM public.order_items WHERE order_id = p_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid
      AND restaurant_id = v_rest
      AND is_active = true
      AND show_in_pos = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;

    IF v_item.is_open_price THEN
      v_unit := (v_line->>'open_price')::numeric;
    ELSE
      v_unit := v_item.base_price;
    END IF;
    IF v_unit IS NULL OR v_unit < 0 THEN RAISE EXCEPTION 'INVALID_OPEN_PRICE'; END IF;

    IF v_item.accepts_modifiers THEN
      FOR v_opt_id IN
        SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid
      LOOP
        SELECT v_unit + o.price_delta INTO v_unit
        FROM public.modifier_options o WHERE o.id = v_opt_id;
      END LOOP;
    END IF;

    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);

    INSERT INTO public.order_items (
      order_id, menu_item_id, name, sku, unit_price, quantity, line_total,
      is_open_price, needs_kitchen, needs_print, line_note, sort_order
    ) VALUES (
      p_order_id, v_item.id, v_item.name, v_item.sku, v_unit,
      greatest((v_line->>'quantity')::int, 1), v_line_total,
      v_item.is_open_price, v_item.needs_kitchen, v_item.needs_print,
      nullif(trim(coalesce(v_line->>'note', '')), ''), v_sort
    ) RETURNING id INTO v_oi_id;

    IF v_item.accepts_modifiers THEN
      INSERT INTO public.order_item_modifiers (
        order_item_id, modifier_option_id, group_name, option_name, price_delta
      )
      SELECT v_oi_id, o.id, g.name, o.name, o.price_delta
      FROM jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb)) opt
      JOIN public.modifier_options o ON o.id = opt::uuid
      JOIN public.modifier_groups g ON g.id = o.group_id;
    END IF;

    PERFORM public.record_order_event(
      p_order_id, 'order.item_added', 'order_item', v_oi_id,
      jsonb_build_object(
        'item_name', v_item.name,
        'quantity', greatest((v_line->>'quantity')::int, 1),
        'via', 'append_after_reopen'
      ),
      v_staff
    );

    v_sort := v_sort + 1;
    v_added := v_added + 1;
  END LOOP;

  SELECT coalesce(sum(line_total), 0) INTO v_new_subtotal
  FROM public.order_items WHERE order_id = p_order_id;
  v_new_total := greatest(v_new_subtotal - coalesce(v_order.discount_amount, 0), 0);
  v_delta := v_new_total - v_old_total;
  IF v_delta <= 0.001 THEN
    RAISE EXCEPTION 'APPEND_MUST_INCREASE_TOTAL';
  END IF;

  UPDATE public.orders
  SET subtotal = v_new_subtotal,
      total = v_new_total,
      last_edited_by = v_staff,
      last_edited_at = now()
  WHERE id = p_order_id;

  PERFORM public.record_order_event(
    p_order_id, 'order.total_changed', 'order', p_order_id,
    jsonb_build_object('from_total', v_old_total, 'to_total', v_new_total, 'via', 'append'),
    v_staff
  );
  PERFORM public.record_order_event(
    p_order_id, 'order.items_appended', 'order', p_order_id,
    jsonb_build_object(
      'added_count', v_added,
      'from_total', v_old_total,
      'to_total', v_new_total,
      'financial_delta', v_delta
    ),
    v_staff
  );

  PERFORM public.m5c_flag_order_review(
    p_order_id,
    coalesce(v_order.review_reason, 'إضافة أصناف بعد إعادة فتح الطلب'),
    v_delta,
    v_staff
  );
  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'added_count', v_added,
    'from_total', v_old_total,
    'to_total', v_new_total,
    'financial_delta', v_delta,
    'money', public.m5c_order_money_snapshot(p_order_id),
    'requires_review', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_order_items(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) edit_pending_order: refuse cancelled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_pending_order(
  p_order_id uuid,
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_tenders jsonb DEFAULT NULL,
  p_order_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_old_total numeric;
  v_new_subtotal numeric := 0;
  v_new_total numeric;
  v_line jsonb;
  v_item public.menu_items%ROWTYPE;
  v_unit numeric;
  v_line_total numeric;
  v_sort int := 0;
  v_had_collection boolean;
  v_old_items jsonb;
  v_old_item record;
  v_new_names text[];
  v_cust_id uuid;
  v_snap jsonb;
  v_delta numeric;
  v_oi_id uuid;
  v_from_qty int;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_order.fulfillment_status = 'cancelled' THEN RAISE EXCEPTION 'ORDER_CANCELLED'; END IF;
  IF v_order.status <> 'closed' THEN RAISE EXCEPTION 'ORDER_NOT_EDITABLE'; END IF;
  IF public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'FREE_EDIT_BLOCKED_AFTER_APPROVE';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;

  v_old_total := v_order.total;
  v_had_collection := public.m5c_order_has_any_collection(p_order_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'menu_item_id', oi.menu_item_id
  )), '[]'::jsonb)
  INTO v_old_items FROM public.order_items oi WHERE oi.order_id = p_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid AND restaurant_id = v_rest
      AND is_active = true AND show_in_pos = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    IF v_unit IS NULL OR v_unit < 0 THEN RAISE EXCEPTION 'INVALID_OPEN_PRICE'; END IF;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_new_subtotal := v_new_subtotal + v_line_total;
  END LOOP;
  v_new_total := greatest(v_new_subtotal - coalesce(v_order.discount_amount, 0), 0);

  DELETE FROM public.kitchen_ticket_lines
  WHERE ticket_id IN (SELECT id FROM public.kitchen_tickets WHERE order_id = p_order_id);

  DELETE FROM public.order_item_modifiers
  WHERE order_item_id IN (SELECT id FROM public.order_items WHERE order_id = p_order_id);
  DELETE FROM public.order_items WHERE order_id = p_order_id;

  v_new_names := ARRAY[]::text[];
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_new_names := array_append(v_new_names, v_item.name);

    INSERT INTO public.order_items (
      order_id, menu_item_id, name, sku, unit_price, quantity, line_total,
      is_open_price, needs_kitchen, needs_print, line_note, sort_order
    ) VALUES (
      p_order_id, v_item.id, v_item.name, v_item.sku, v_unit,
      greatest((v_line->>'quantity')::int, 1), v_line_total,
      v_item.is_open_price, v_item.needs_kitchen, v_item.needs_print,
      nullif(trim(coalesce(v_line->>'note', '')), ''), v_sort
    ) RETURNING id INTO v_oi_id;

    IF v_item.accepts_modifiers AND v_line->'modifier_option_ids' IS NOT NULL THEN
      INSERT INTO public.order_item_modifiers (order_item_id, modifier_option_id, group_name, option_name, price_delta)
      SELECT v_oi_id, o.id, g.name, o.name, o.price_delta
      FROM jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb)) opt
      JOIN public.modifier_options o ON o.id = opt::uuid
      JOIN public.modifier_groups g ON g.id = o.group_id;
    END IF;
    v_sort := v_sort + 1;
  END LOOP;

  FOR v_old_item IN SELECT * FROM jsonb_to_recordset(v_old_items)
    AS x(id uuid, name text, quantity int, menu_item_id uuid)
  LOOP
    IF NOT (v_old_item.name = ANY (v_new_names)) THEN
      PERFORM public.record_order_event(p_order_id, 'order.item_removed', 'order_item', v_old_item.id,
        jsonb_build_object('item_name', v_old_item.name, 'quantity', v_old_item.quantity));
    END IF;
  END LOOP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT name INTO v_item.name FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_old_items) oi WHERE oi->>'name' = v_item.name
    ) THEN
      PERFORM public.record_order_event(p_order_id, 'order.item_added', 'order', p_order_id,
        jsonb_build_object('item_name', v_item.name, 'quantity', (v_line->>'quantity')::int));
    ELSE
      SELECT (oi->>'quantity')::int INTO v_from_qty
      FROM jsonb_array_elements(v_old_items) oi WHERE oi->>'name' = v_item.name LIMIT 1;
      IF v_from_qty IS DISTINCT FROM (v_line->>'quantity')::int THEN
        PERFORM public.record_order_event(p_order_id, 'order.qty_changed', 'order', p_order_id,
          jsonb_build_object('item_name', v_item.name, 'from_qty', v_from_qty, 'to_qty', (v_line->>'quantity')::int));
      END IF;
    END IF;
  END LOOP;

  IF p_customer_id IS NOT NULL OR (p_customer_phone IS NOT NULL AND length(trim(p_customer_phone)) > 0) THEN
    v_cust_id := p_customer_id;
    IF v_cust_id IS NULL THEN
      v_cust_id := public.upsert_customer(
        coalesce(nullif(trim(p_customer_name), ''), 'عميل'),
        p_customer_phone, NULL, NULL, NULL
      );
    END IF;
    IF v_cust_id IS DISTINCT FROM v_order.customer_id
       OR nullif(trim(coalesce(p_customer_name, '')), '') IS DISTINCT FROM v_order.delivery_name THEN
      UPDATE public.orders SET
        customer_id = v_cust_id,
        delivery_name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), delivery_name),
        delivery_phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), delivery_phone)
      WHERE id = p_order_id;
      PERFORM public.record_order_event(p_order_id, 'order.customer_changed', 'customer', v_cust_id,
        jsonb_build_object('customer_id', v_cust_id, 'name', p_customer_name));
    END IF;
  END IF;

  UPDATE public.orders SET
    subtotal = v_new_subtotal,
    total = v_new_total,
    order_note = CASE WHEN p_order_note IS NULL THEN order_note ELSE nullif(trim(p_order_note), '') END
  WHERE id = p_order_id;

  IF v_new_total IS DISTINCT FROM v_old_total THEN
    PERFORM public.record_order_event(p_order_id, 'order.total_changed', 'order', p_order_id,
      jsonb_build_object('from_total', v_old_total, 'to_total', v_new_total));
  END IF;

  IF p_tenders IS NOT NULL AND p_tenders <> 'null'::jsonb AND jsonb_array_length(p_tenders) > 0 THEN
    UPDATE public.order_payments
    SET collection_status = 'rejected',
        rejected_by = v_staff,
        rejected_at = now(),
        rejection_reason = 'استبدال طريقة الدفع عند تعديل الطلب'
    WHERE order_id = p_order_id AND collection_status = 'pending';

    PERFORM public.record_order_event(p_order_id, 'order.tender_changed', 'order', p_order_id,
      jsonb_build_object('action', 'replace_pending_tenders'));

    PERFORM public.m5b_recalc_order_payment_status(p_order_id);
    PERFORM public.record_collection(p_order_id, p_tenders);
  ELSE
    PERFORM public.m5b_recalc_order_payment_status(p_order_id);
  END IF;

  v_snap := public.m5c_order_money_snapshot(p_order_id);
  v_delta := v_new_total - v_old_total;

  IF v_had_collection THEN
    PERFORM public.m5c_flag_order_review(
      p_order_id, 'تم تعديل الطلب بعد تسجيل التحصيل', v_delta, v_staff
    );
  END IF;

  PERFORM public.log_audit_event(v_rest, 'order.edited', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('from_total', v_old_total, 'to_total', v_new_total));

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'money', v_snap,
    'requires_review', (SELECT requires_review FROM public.orders WHERE id = p_order_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_pending_order(uuid, jsonb, uuid, text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Enrich list/detail/review queue for UI
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_orders_requiring_review(p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY flagged_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'cashier_id', o.created_by,
        'cashier_name', s.display_name,
        'review_reason', o.review_reason,
        'requires_review', o.requires_review,
        'money', public.m5c_order_money_snapshot(o.id),
        'flagged_at', (
          SELECT e.created_at FROM public.order_events e
          WHERE e.order_id = o.id
            AND e.event_type IN ('order.reopened', 'order.review_flagged')
          ORDER BY e.created_at DESC LIMIT 1
        ),
        'flagged_by_name', (
          SELECT st.display_name
          FROM public.order_events e
          LEFT JOIN public.staff st ON st.id = e.actor_id
          WHERE e.order_id = o.id
            AND e.event_type IN ('order.reopened', 'order.review_flagged')
          ORDER BY e.created_at DESC LIMIT 1
        ),
        'last_edit_at', (
          SELECT max(e.created_at) FROM public.order_events e
          WHERE e.order_id = o.id AND e.event_type LIKE 'order.%'
            AND e.event_type NOT IN ('order.created', 'order.review_cleared')
        ),
        'financial_delta', (
          SELECT (e.payload->>'financial_delta')::numeric
          FROM public.order_events e
          WHERE e.order_id = o.id
            AND e.event_type IN ('order.review_flagged', 'order.items_appended')
            AND e.payload ? 'financial_delta'
          ORDER BY e.created_at DESC LIMIT 1
        ),
        'created_at', o.created_at
      ) AS row,
      coalesce((
        SELECT max(e.created_at) FROM public.order_events e
        WHERE e.order_id = o.id
          AND e.event_type IN ('order.reopened', 'order.review_flagged')
      ), o.created_at) AS flagged_at
      FROM public.orders o
      LEFT JOIN public.staff s ON s.id = o.created_by
      WHERE o.restaurant_id = v_rest AND o.requires_review = true
      ORDER BY flagged_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_orders_requiring_review(int, int) TO authenticated;

-- Expose review_reason on operational list (for red review cards).
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

GRANT EXECUTE ON FUNCTION public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int, uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
