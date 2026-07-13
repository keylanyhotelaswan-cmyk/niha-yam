-- M6C: Wire sale/create/collection RPCs to document-type print enqueue

CREATE OR REPLACE FUNCTION public.create_unpaid_order(
  p_items jsonb,
  p_order_type public.pos_order_type DEFAULT 'takeaway',
  p_customer_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_order_note text DEFAULT NULL,
  p_dine_in_table_ref text DEFAULT NULL,
  p_delivery_driver_id uuid DEFAULT NULL
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

  IF p_delivery_driver_id IS NOT NULL THEN
    IF p_order_type <> 'delivery' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_drivers
      WHERE id = p_delivery_driver_id AND restaurant_id = v_rest AND is_active = true
    ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
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

  v_fulfillment := CASE
    WHEN p_order_type = 'takeaway' THEN 'delivered'::public.order_fulfillment_status
    ELSE 'new'::public.order_fulfillment_status
  END;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, order_type,
    payment_status, fulfillment_status, print_status,
    subtotal, discount_amount, total, order_note,
    customer_id, delivery_name, delivery_phone, delivery_address, delivery_zone, delivery_notes,
    dine_in_table_ref, delivery_driver_id,
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
    nullif(trim(coalesce(p_dine_in_table_ref, '')), ''),
    NULL,
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
    jsonb_build_object(
      'reference', v_ord_ref, 'total', v_total,
      'order_type', p_order_type::text, 'pay_later', true,
      'dine_in_table_ref', nullif(trim(coalesce(p_dine_in_table_ref, '')), '')
    ));

  IF p_delivery_driver_id IS NOT NULL THEN
    PERFORM public.assign_delivery_driver(v_order_id, p_delivery_driver_id, 'تعيين عند الإنشاء');
  END IF;

  -- M6: kitchen@create only (no receipt for unpaid)
  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, false);

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ord_ref,
    'money', public.m5c_order_money_snapshot(v_order_id)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_sale(
  p_items jsonb,
  p_tenders jsonb,
  p_discount jsonb DEFAULT NULL,
  p_order_note text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL,
  p_order_type public.pos_order_type DEFAULT 'takeaway',
  p_customer_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_dine_in_table_ref text DEFAULT NULL,
  p_delivery_driver_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_drawer uuid;
  v_ord_ref text;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_discount_amt numeric := 0;
  v_total numeric;
  v_line jsonb;
  v_item public.menu_items%ROWTYPE;
  v_opt_id uuid;
  v_unit numeric;
  v_line_total numeric;
  v_order_item_id uuid;
  v_sort int := 0;
  v_mod_summary text;
  v_tender jsonb;
  v_pm public.payment_methods%ROWTYPE;
  v_pay_ref text;
  v_pay_id uuid;
  v_tender_sum numeric := 0;
  v_non_cash numeric := 0;
  v_cash_tender numeric := 0;
  v_cash_required numeric;
  v_change numeric := 0;
  v_has_kitchen boolean := false;
  v_kt_id uuid;
  v_kt_ref text;
  v_pj_ref text;
  v_existing uuid;
  v_disc_type public.discount_type;
  v_disc_value numeric;
  v_disc_reason text;
  v_group record;
  v_sel_count int;
  v_remaining_due numeric;
  v_tender_amt numeric;
  v_net numeric;
  v_tender_change numeric;
  v_pj_id uuid;
  v_order_type public.pos_order_type := coalesce(p_order_type, 'takeaway');
  v_fulfillment public.order_fulfillment_status;
  v_cust_id uuid := p_customer_id;
  v_cust_name text;
  v_cust_phone text;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true AND is_active = true;

  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.orders
    WHERE restaurant_id = v_rest AND client_request_id = p_client_request_id;
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'DUPLICATE_REQUEST'; END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

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

  IF p_delivery_driver_id IS NOT NULL THEN
    IF v_order_type <> 'delivery' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_drivers
      WHERE id = p_delivery_driver_id AND restaurant_id = v_rest AND is_active = true
    ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;

  v_fulfillment := CASE
    WHEN v_order_type = 'takeaway' THEN 'delivered'::public.order_fulfillment_status
    ELSE 'new'::public.order_fulfillment_status
  END;

  IF p_discount IS NOT NULL AND p_discount <> 'null'::jsonb THEN
    IF NOT public.pos_staff_can_discount() THEN RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED'; END IF;
    v_disc_type := (p_discount->>'type')::public.discount_type;
    v_disc_value := (p_discount->>'value')::numeric;
    v_disc_reason := nullif(trim(coalesce(p_discount->>'reason', '')), '');
    IF v_disc_value IS NULL OR v_disc_value <= 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF v_disc_type = 'percent' AND v_disc_value > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF length(coalesce(v_disc_reason, '')) = 0 THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED'; END IF;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid AND restaurant_id = v_rest
      AND is_active = true AND show_in_pos = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;

    IF v_item.is_open_price THEN
      v_unit := (v_line->>'open_price')::numeric;
      IF v_unit IS NULL OR v_unit < 0 THEN RAISE EXCEPTION 'INVALID_OPEN_PRICE'; END IF;
    ELSE
      v_unit := v_item.base_price;
    END IF;

    IF v_item.accepts_modifiers THEN
      FOR v_group IN
        SELECT g.id, g.min_selections, g.max_selections
        FROM public.menu_item_modifier_groups l
        JOIN public.modifier_groups g ON g.id = l.modifier_group_id
        WHERE l.menu_item_id = v_item.id AND g.is_active = true
      LOOP
        SELECT count(*)::int INTO v_sel_count
        FROM jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb)) opt
        JOIN public.modifier_options o ON o.id = opt::uuid
        WHERE o.group_id = v_group.id AND o.is_active = true;
        IF v_sel_count < v_group.min_selections
           OR (v_group.max_selections > 0 AND v_sel_count > v_group.max_selections) THEN
          RAISE EXCEPTION 'INVALID_MODIFIERS';
        END IF;
      END LOOP;

      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.modifier_options o
          JOIN public.menu_item_modifier_groups l ON l.modifier_group_id = o.group_id
          WHERE o.id = v_opt_id AND l.menu_item_id = v_item.id AND o.is_active = true
        ) THEN RAISE EXCEPTION 'INVALID_MODIFIERS'; END IF;
        SELECT v_unit + o.price_delta INTO v_unit FROM public.modifier_options o WHERE o.id = v_opt_id;
      END LOOP;
    END IF;

    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  IF p_discount IS NOT NULL AND p_discount <> 'null'::jsonb THEN
    IF v_disc_type = 'percent' THEN
      v_discount_amt := round(v_subtotal * v_disc_value / 100, 2);
    ELSE
      v_discount_amt := v_disc_value;
    END IF;
    IF v_discount_amt > v_subtotal THEN v_discount_amt := v_subtotal; END IF;
  END IF;
  v_total := v_subtotal - v_discount_amt;

  v_remaining_due := v_total;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    v_tender_amt := (v_tender->>'amount')::numeric;
    IF coalesce(v_tender_amt, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

    IF v_pm.code = 'cash' THEN
      v_cash_tender := v_cash_tender + v_tender_amt;
    ELSE
      IF v_tender_amt > v_remaining_due + 0.001 THEN RAISE EXCEPTION 'DIGITAL_OVERPAY'; END IF;
      v_non_cash := v_non_cash + v_tender_amt;
      v_remaining_due := v_remaining_due - v_tender_amt;
    END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum < v_total THEN RAISE EXCEPTION 'UNDERPAID'; END IF;
  v_cash_required := v_total - v_non_cash;
  IF v_cash_required < 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
  IF v_cash_tender < v_cash_required THEN RAISE EXCEPTION 'UNDERPAID'; END IF;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, order_type,
    payment_status, fulfillment_status, print_status,
    subtotal, discount_amount, total,
    discount_type, discount_value, discount_reason, order_note, client_request_id,
    customer_id, delivery_name, delivery_phone, delivery_address, delivery_zone, delivery_notes,
    dine_in_table_ref, delivery_driver_id,
    created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', v_order_type,
    'unpaid', v_fulfillment, 'pending',
    v_subtotal, v_discount_amt, v_total,
    v_disc_type, v_disc_value, v_disc_reason,
    nullif(trim(coalesce(p_order_note, '')), ''), p_client_request_id,
    v_cust_id,
    coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), v_cust_name),
    coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), v_cust_phone),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    nullif(trim(coalesce(p_delivery_zone, '')), ''),
    nullif(trim(coalesce(p_delivery_notes, '')), ''),
    nullif(trim(coalesce(p_dine_in_table_ref, '')), ''),
    NULL,
    v_staff, now()
  ) RETURNING id INTO v_order_id;

  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,
    jsonb_build_object(
      'reference', v_ord_ref, 'total', v_total,
      'order_type', v_order_type::text, 'pay_now', true,
      'dine_in_table_ref', nullif(trim(coalesce(p_dine_in_table_ref, '')), '')
    ));

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    IF v_item.is_open_price THEN v_unit := (v_line->>'open_price')::numeric;
    ELSE v_unit := v_item.base_price; END IF;
    v_mod_summary := '';
    IF v_item.accepts_modifiers THEN
      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid LOOP
        SELECT v_unit + o.price_delta, v_mod_summary || CASE WHEN v_mod_summary = '' THEN '' ELSE ', ' END || o.name
        INTO v_unit, v_mod_summary FROM public.modifier_options o WHERE o.id = v_opt_id;
      END LOOP;
    END IF;
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
    ) RETURNING id INTO v_order_item_id;

    IF v_item.accepts_modifiers THEN
      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid LOOP
        INSERT INTO public.order_item_modifiers (order_item_id, modifier_option_id, group_name, option_name, price_delta)
        SELECT v_order_item_id, o.id, g.name, o.name, o.price_delta
        FROM public.modifier_options o JOIN public.modifier_groups g ON g.id = o.group_id
        WHERE o.id = v_opt_id;
      END LOOP;
    END IF;
    v_sort := v_sort + 1;
  END LOOP;

  v_remaining_due := v_total;
  v_change := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods WHERE id = (v_tender->>'payment_method_id')::uuid;
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_change := 0;
    IF v_pm.code = 'cash' THEN
      v_net := least(v_tender_amt, v_remaining_due);
      v_tender_change := v_tender_amt - v_net;
      v_remaining_due := v_remaining_due - v_net;
      v_change := v_change + v_tender_change;
    ELSE
      v_net := v_tender_amt;
      v_remaining_due := v_remaining_due - v_net;
    END IF;

    v_pay_ref := public.next_financial_ref(v_rest, 'payment', 'PAY');
    INSERT INTO public.order_payments (
      order_id, reference, payment_method_id, treasury_id, amount, change_given,
      shift_id, collection_status, net_amount, created_by
    ) VALUES (
      v_order_id, v_pay_ref, v_pm.id, v_pm.treasury_id, v_tender_amt, v_tender_change,
      v_shift, 'pending', v_net, v_staff
    ) RETURNING id INTO v_pay_id;

    PERFORM public.record_order_event(v_order_id, 'collection.recorded', 'order_payment', v_pay_id,
      jsonb_build_object('reference', v_pay_ref, 'amount', v_tender_amt, 'net_amount', v_net));
  END LOOP;

  PERFORM public.m5b_recalc_order_payment_status(v_order_id);

  IF v_has_kitchen THEN
    v_kt_ref := public.next_financial_ref(v_rest, 'kitchen_ticket', 'KT');
    INSERT INTO public.kitchen_tickets (restaurant_id, order_id, reference, shift_id, status)
    VALUES (v_rest, v_order_id, v_kt_ref, v_shift, 'new') RETURNING id INTO v_kt_id;

    INSERT INTO public.kitchen_ticket_lines (ticket_id, order_item_id, name, quantity, line_note, modifier_summary, sort_order)
    SELECT v_kt_id, oi.id, oi.name, oi.quantity, oi.line_note,
      (SELECT string_agg(oim.option_name, ', ') FROM public.order_item_modifiers oim WHERE oim.order_item_id = oi.id),
      oi.sort_order
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id AND oi.needs_kitchen = true;

    PERFORM public.record_order_event(v_order_id, 'kitchen.sent', 'kitchen_ticket', v_kt_id,
      jsonb_build_object('reference', v_kt_ref));
  END IF;

  -- M6: kitchen@create + receipt@Pay Now
  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, true);

  IF p_delivery_driver_id IS NOT NULL THEN
    PERFORM public.assign_delivery_driver(v_order_id, p_delivery_driver_id, 'تعيين عند الإنشاء');
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ord_ref,
    'subtotal', v_subtotal,
    'discount_amount', v_discount_amt,
    'total', v_total,
    'change', v_change,
    'kitchen_ticket_id', v_kt_id,
    'operational_drawer_balance',
      CASE WHEN v_drawer IS NULL THEN NULL
      ELSE public.m5b_operational_treasury_balance(v_drawer, v_shift) END,
    'money', public.m5c_order_money_snapshot(v_order_id)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.record_collection(
  p_order_id uuid,
  p_tenders jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_total numeric;
  v_paid_pending numeric;
  v_paid_approved numeric;
  v_remaining numeric;
  v_tender jsonb;
  v_pm public.payment_methods%ROWTYPE;
  v_tender_amt numeric;
  v_pay_ref text;
  v_pay_id uuid;
  v_net numeric;
  v_tender_change numeric;
  v_remaining_due numeric;
  v_cash_tender numeric;
  v_non_cash numeric;
  v_cash_required numeric;
  v_tender_sum numeric := 0;
  v_ids uuid[] := '{}';
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_pending
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'pending';
  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_approved
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'approved';
  v_remaining := v_total - v_paid_approved - v_paid_pending;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  v_remaining_due := v_remaining;
  v_cash_tender := 0;
  v_non_cash := 0;
  v_tender_sum := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    v_tender_amt := (v_tender->>'amount')::numeric;
    IF coalesce(v_tender_amt, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
    IF v_pm.code = 'cash' THEN v_cash_tender := v_cash_tender + v_tender_amt;
    ELSE
      IF v_tender_amt > v_remaining_due + 0.001 THEN RAISE EXCEPTION 'DIGITAL_OVERPAY'; END IF;
      v_non_cash := v_non_cash + v_tender_amt;
      v_remaining_due := v_remaining_due - v_tender_amt;
    END IF;
  END LOOP;

  -- Partial allowed: tenders may cover less than full remaining (ADR-0025 / M5C)
  IF v_tender_sum <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
  v_cash_required := least(v_remaining, v_non_cash + v_cash_tender) - v_non_cash;
  IF v_cash_required < 0 THEN v_cash_required := 0; END IF;
  IF v_cash_tender < v_cash_required THEN RAISE EXCEPTION 'UNDERPAID'; END IF;

  v_remaining_due := v_remaining;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods WHERE id = (v_tender->>'payment_method_id')::uuid;
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_change := 0;
    IF v_pm.code = 'cash' THEN
      v_net := least(v_tender_amt, v_remaining_due);
      v_tender_change := v_tender_amt - v_net;
      v_remaining_due := v_remaining_due - v_net;
    ELSE
      v_net := v_tender_amt;
      v_remaining_due := v_remaining_due - v_net;
    END IF;

    v_pay_ref := public.next_financial_ref(v_rest, 'payment', 'PAY');
    INSERT INTO public.order_payments (
      order_id, reference, payment_method_id, treasury_id, amount, change_given,
      shift_id, collection_status, net_amount, created_by
    ) VALUES (
      p_order_id, v_pay_ref, v_pm.id, v_pm.treasury_id, v_tender_amt, v_tender_change,
      v_shift, 'pending', v_net, v_staff
    ) RETURNING id INTO v_pay_id;

    v_ids := array_append(v_ids, v_pay_id);
    PERFORM public.record_order_event(p_order_id, 'collection.recorded', 'order_payment', v_pay_id,
      jsonb_build_object('reference', v_pay_ref, 'amount', v_tender_amt, 'net_amount', v_net));
  END LOOP;

  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  -- M6: receipt on each real collection
  PERFORM public.m6_enqueue_receipt_on_collection(p_order_id);

  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));
END; $$;

CREATE OR REPLACE FUNCTION public.create_delivery_order(
  p_items jsonb,
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
  v_order_item_id uuid;
  v_sort int := 0;
  v_has_kitchen boolean := false;
  v_kt_id uuid;
  v_kt_ref text;
  v_cust_id uuid := p_customer_id;
  v_cust_name text;
  v_cust_phone text;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;

  IF v_cust_id IS NULL AND p_customer_phone IS NOT NULL THEN
    v_cust_id := public.upsert_customer(
      coalesce(p_customer_name, 'عميل'),
      p_customer_phone,
      NULL,
      p_delivery_address,
      p_delivery_zone
    );
  END IF;

  IF v_cust_id IS NOT NULL THEN
    SELECT display_name INTO v_cust_name FROM public.customers WHERE id = v_cust_id;
    SELECT phone_raw INTO v_cust_phone FROM public.customer_phones
    WHERE customer_id = v_cust_id AND is_primary = true LIMIT 1;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := v_subtotal;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, order_type,
    payment_status, fulfillment_status, print_status,
    subtotal, discount_amount, total, order_note,
    customer_id, delivery_name, delivery_phone, delivery_address, delivery_zone, delivery_notes,
    created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', 'delivery',
    'unpaid', 'new', 'pending',
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
    PERFORM public.record_order_event(v_order_id, 'kitchen.sent', 'kitchen_ticket', v_kt_id,
      jsonb_build_object('reference', v_kt_ref));
  END IF;

  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('reference', v_ord_ref, 'total', v_total, 'order_type', 'delivery'));

  -- M6: kitchen@create only
  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, false);

  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_ord_ref, 'total', v_total);
END; $$;

NOTIFY pgrst, 'reload schema';
