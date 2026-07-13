-- M5C RPCs part 2: edit_pending_order, list/detail money fields, review queue,
-- amend gate, notification settings.

-- ---------------------------------------------------------------------------
-- edit_pending_order — free edit when NO approved collections
-- p_items: full replacement cart (same shape as finalize_sale items)
-- p_customer_*: optional customer update
-- p_tenders: optional — if provided, reject all pending collections then record new
--            (append-only). If null, keep existing collections; Remaining may grow.
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
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
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

  -- Validate + compute new subtotal
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
  -- Keep existing discount amount if any (simple: proportional not applied — keep absolute discount capped)
  v_new_total := greatest(v_new_subtotal - coalesce(v_order.discount_amount, 0), 0);

  -- Replace lines (operational rewrite — not financial ledger)
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

  -- Timeline: removed / added / qty (simplified human events)
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
      SELECT 1 FROM jsonb_array_elements(v_old_items) oi
      WHERE oi->>'name' = v_item.name
    ) THEN
      PERFORM public.record_order_event(p_order_id, 'order.item_added', 'order', p_order_id,
        jsonb_build_object('item_name', v_item.name, 'quantity', (v_line->>'quantity')::int));
    ELSE
      -- qty change detection
      SELECT (oi->>'quantity')::int INTO v_sort
      FROM jsonb_array_elements(v_old_items) oi WHERE oi->>'name' = v_item.name LIMIT 1;
      IF v_sort IS DISTINCT FROM (v_line->>'quantity')::int THEN
        PERFORM public.record_order_event(p_order_id, 'order.qty_changed', 'order', p_order_id,
          jsonb_build_object('item_name', v_item.name, 'from_qty', v_sort, 'to_qty', (v_line->>'quantity')::int));
      END IF;
    END IF;
  END LOOP;

  -- Customer update
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

  -- Tender replace (append-only): reject pending then record new
  IF p_tenders IS NOT NULL AND p_tenders <> 'null'::jsonb AND jsonb_array_length(p_tenders) > 0 THEN
    -- Reject existing pending rows
    UPDATE public.order_payments
    SET collection_status = 'rejected',
        rejected_by = v_staff,
        rejected_at = now(),
        rejection_reason = 'استبدال طريقة الدفع عند تعديل الطلب'
    WHERE order_id = p_order_id AND collection_status = 'pending';

    PERFORM public.record_order_event(p_order_id, 'order.tender_changed', 'order', p_order_id,
      jsonb_build_object('action', 'replace_pending_tenders'));

    -- record_collection will add new pending rows for full remaining after recalc
    PERFORM public.m5b_recalc_order_payment_status(p_order_id);
    PERFORM public.record_collection(p_order_id, p_tenders);
  ELSE
    PERFORM public.m5b_recalc_order_payment_status(p_order_id);
  END IF;

  v_snap := public.m5c_order_money_snapshot(p_order_id);
  v_delta := v_new_total - v_old_total;

  IF v_had_collection THEN
    PERFORM public.m5c_flag_order_review(
      p_order_id,
      'تم تعديل الطلب بعد تسجيل التحصيل',
      v_delta,
      v_staff
    );
  END IF;

  PERFORM public.log_audit_event(v_rest, 'order.edited', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('from_total', v_old_total, 'to_total', v_new_total));

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'money', v_snap,
    'requires_review', (SELECT requires_review FROM public.orders WHERE id = p_order_id)
  );
END; $$;

-- Collect remaining only (wrapper clarity for POS)
CREATE OR REPLACE FUNCTION public.collect_remaining(p_order_id uuid, p_tenders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_snap jsonb;
  v_result jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  v_snap := public.m5c_order_money_snapshot(p_order_id);
  IF (v_snap->>'remaining_amount')::numeric <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  v_result := public.record_collection(p_order_id, p_tenders);
  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  IF public.m5c_order_has_any_collection(p_order_id) THEN
    -- collecting after prior collection or after edit — flag if order already had collection before this call
    -- record_collection always creates; flag when more than this batch exists historically is handled by edit path.
    NULL;
  END IF;

  RETURN jsonb_build_object(
    'payment_ids', v_result->'payment_ids',
    'money', public.m5c_order_money_snapshot(p_order_id)
  );
END; $$;

-- After record_collection, recalc customer payment status (patch via replace)
-- Ensure record_collection callers get updated status — add trigger-like end in wrapper used by UI.

-- ---------------------------------------------------------------------------
-- list / detail with four amounts
-- ---------------------------------------------------------------------------
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
DECLARE v_rest uuid := public.auth_restaurant_id(); v_search text;
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
        'has_approved_collection', public.m5c_order_has_approved_collection(o.id)
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
        'id', op.id, 'reference', op.reference, 'amount', op.amount,
        'change_given', op.change_given, 'net_amount', op.net_amount,
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'created_at', op.created_at, 'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
    'timeline', public.get_order_timeline(p_order_id)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.get_order_timeline(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'label', coalesce(e.payload->>'label_ar', public.m5c_timeline_label(e.event_type, e.payload)),
      'actor_id', e.actor_id,
      'entity_type', e.entity_type,
      'entity_id', e.entity_id,
      'payload', e.payload,
      'created_at', e.created_at
    ) ORDER BY e.created_at ASC)
    FROM public.order_events e
    WHERE e.order_id = p_order_id
  ), '[]'::jsonb);
END; $$;

-- Review queue
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
        'last_edit_at', (
          SELECT max(e.created_at) FROM public.order_events e
          WHERE e.order_id = o.id AND e.event_type LIKE 'order.%'
            AND e.event_type NOT IN ('order.created', 'order.review_cleared')
        ),
        'financial_delta', (
          SELECT (e.payload->>'financial_delta')::numeric
          FROM public.order_events e
          WHERE e.order_id = o.id AND e.event_type = 'order.review_flagged'
          ORDER BY e.created_at DESC LIMIT 1
        ),
        'created_at', o.created_at
      ) AS row,
      coalesce((
        SELECT max(e.created_at) FROM public.order_events e
        WHERE e.order_id = o.id AND e.event_type = 'order.review_flagged'
      ), o.created_at) AS flagged_at
      FROM public.orders o
      LEFT JOIN public.staff s ON s.id = o.created_by
      WHERE o.restaurant_id = v_rest AND o.requires_review = true
      ORDER BY flagged_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END; $$;

-- Formal amend after approve — M5C gate (full delta UI can grow; blocks free path)
CREATE OR REPLACE FUNCTION public.amend_order(
  p_order_id uuid,
  p_items jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Free edit must use edit_pending_order. After approve, full amend is a later slice;
  -- for now require manager + reason and refuse silent free rewrite.
  PERFORM public.m4_require_manager();
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF NOT public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'USE_EDIT_PENDING_ORDER';
  END IF;
  -- Explicit: post-approve structural amend not fully implemented in this slice —
  -- financial path is reverse_collection + record_collection for deltas.
  RAISE EXCEPTION 'AMEND_USE_FINANCIAL_DELTA';
END; $$;

-- Notification settings
CREATE OR REPLACE FUNCTION public.get_notification_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_row public.restaurant_notification_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.restaurant_notification_settings WHERE restaurant_id = v_rest;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'notify_on_order_edit', false,
      'providers', '[]'::jsonb
    );
  END IF;
  RETURN jsonb_build_object(
    'notify_on_order_edit', v_row.notify_on_order_edit,
    'providers', v_row.providers
  );
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_notification_settings(
  p_notify_on_order_edit boolean,
  p_providers jsonb DEFAULT '[]'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  INSERT INTO public.restaurant_notification_settings (restaurant_id, notify_on_order_edit, providers, updated_at)
  VALUES (v_rest, coalesce(p_notify_on_order_edit, false), coalesce(p_providers, '[]'::jsonb), now())
  ON CONFLICT (restaurant_id) DO UPDATE SET
    notify_on_order_edit = excluded.notify_on_order_edit,
    providers = excluded.providers,
    updated_at = now();
END; $$;

-- Patch finalize_sale return + recalc after pending collections
-- (payment_status should reflect Collected including pending)
CREATE OR REPLACE FUNCTION public.m5c_after_finalize_recalc(p_order_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.m5b_recalc_order_payment_status(p_order_id);
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.create_unpaid_order(jsonb, public.pos_order_type, uuid, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_pending_order(uuid, jsonb, uuid, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_remaining(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_order_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_orders_requiring_review(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amend_order(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_notification_settings(boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m5c_order_money_snapshot(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
