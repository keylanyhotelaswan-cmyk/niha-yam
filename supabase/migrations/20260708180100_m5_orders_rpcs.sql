-- M5: POS RPCs — menu favorites, context bootstrap, PIN resolve (service role), finalize_sale.

-- Helpers ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_staff_can_discount()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = public.auth_staff_id()
      AND sb.role IN ('owner', 'manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.pos_require_open_shift(p_rest uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shift uuid;
BEGIN
  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = p_rest AND status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;
  RETURN v_shift;
END; $$;

-- PIN login (service role only — Edge Function pos-pin-login) ---------------
CREATE OR REPLACE FUNCTION public.resolve_staff_user_by_pin(p_pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 6 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_PIN';
  END IF;
  FOR r IN
    SELECT s.id, s.user_id, s.restaurant_id, s.pin_hash
    FROM public.staff s
    WHERE s.is_active = true AND s.pin_hash IS NOT NULL
  LOOP
    IF r.pin_hash = extensions.crypt(p_pin, r.pin_hash) THEN
      PERFORM public.log_audit_event(r.restaurant_id, 'auth.pin_login', NULL, r.id,
        'staff', r.id, NULL, NULL);
      RETURN r.user_id;
    END IF;
  END LOOP;
  PERFORM public.log_audit_event(
    (SELECT id FROM public.restaurants LIMIT 1),
    'auth.pin_login_failed', NULL, NULL, NULL, NULL, NULL, NULL);
  RAISE EXCEPTION 'PIN_INVALID';
END; $$;

REVOKE ALL ON FUNCTION public.resolve_staff_user_by_pin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_staff_user_by_pin(text) TO service_role;

-- list_menu_for_pos: add top-level favorites[] (Q-B1) ----------------------
CREATE OR REPLACE FUNCTION public.list_menu_for_pos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_restaurant_id uuid;
BEGIN
  v_restaurant_id := public.auth_restaurant_id();
  IF v_restaurant_id IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  RETURN jsonb_build_object(
    'favorites', coalesce((
      SELECT jsonb_agg(item ORDER BY sort_order, name)
      FROM (
        SELECT
          i.sort_order, i.name,
          jsonb_build_object(
            'id', i.id, 'name', i.name, 'sku', i.sku, 'base_price', i.base_price,
            'sort_order', i.sort_order, 'category_id', i.category_id,
            'needs_kitchen', i.needs_kitchen, 'needs_print', i.needs_print,
            'accepts_modifiers', i.accepts_modifiers, 'allows_discounts', i.allows_discounts,
            'is_open_price', i.is_open_price, 'is_favorite', i.is_favorite,
            'modifier_groups', CASE WHEN i.accepts_modifiers THEN coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'min_selections', g.min_selections,
                'max_selections', g.max_selections,
                'options', coalesce((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', o.id, 'name', o.name, 'price_delta', o.price_delta, 'is_default', o.is_default
                  ) ORDER BY o.sort_order, o.name)
                  FROM public.modifier_options o WHERE o.group_id = g.id AND o.is_active = true
                ), '[]'::jsonb)
              ) ORDER BY l.sort_order, g.sort_order)
              FROM public.menu_item_modifier_groups l
              JOIN public.modifier_groups g ON g.id = l.modifier_group_id
              WHERE l.menu_item_id = i.id AND g.is_active = true
            ), '[]'::jsonb) ELSE '[]'::jsonb END
          ) AS item
        FROM public.menu_items i
        WHERE i.restaurant_id = v_restaurant_id AND i.is_active = true
          AND i.show_in_pos = true AND i.is_favorite = true
      ) fav
    ), '[]'::jsonb),
    'categories', coalesce((
      SELECT jsonb_agg(cat ORDER BY cat_sort, cat_name)
      FROM (
        SELECT c.sort_order AS cat_sort, c.name AS cat_name,
          jsonb_build_object(
            'id', c.id, 'name', c.name, 'sort_order', c.sort_order,
            'items', items.items_json
          ) AS cat
        FROM public.menu_categories c
        JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', i.id, 'name', i.name, 'sku', i.sku, 'base_price', i.base_price,
              'sort_order', i.sort_order, 'category_id', i.category_id,
              'needs_kitchen', i.needs_kitchen, 'needs_print', i.needs_print,
              'accepts_modifiers', i.accepts_modifiers, 'allows_discounts', i.allows_discounts,
              'is_open_price', i.is_open_price, 'is_favorite', i.is_favorite,
              'modifier_groups', CASE WHEN i.accepts_modifiers THEN coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', g.id, 'name', g.name, 'min_selections', g.min_selections,
                  'max_selections', g.max_selections,
                  'options', coalesce((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id', o.id, 'name', o.name, 'price_delta', o.price_delta, 'is_default', o.is_default
                    ) ORDER BY o.sort_order, o.name)
                    FROM public.modifier_options o WHERE o.group_id = g.id AND o.is_active = true
                  ), '[]'::jsonb)
                ) ORDER BY l.sort_order, g.sort_order)
                FROM public.menu_item_modifier_groups l
                JOIN public.modifier_groups g ON g.id = l.modifier_group_id
                WHERE l.menu_item_id = i.id AND g.is_active = true
              ), '[]'::jsonb) ELSE '[]'::jsonb END
            ) ORDER BY i.sort_order, i.name
          ) AS items_json
          FROM public.menu_items i
          WHERE i.category_id = c.id AND i.restaurant_id = v_restaurant_id
            AND i.is_active = true AND i.show_in_pos = true
        ) items ON items.items_json IS NOT NULL
        WHERE c.restaurant_id = v_restaurant_id AND c.is_active = true AND c.show_in_pos = true
      ) ordered
    ), '[]'::jsonb)
  );
END; $$;

-- POS bootstrap: shift + payment methods + discount flag (one round trip) ----
CREATE OR REPLACE FUNCTION public.get_pos_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift uuid;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT id INTO v_shift FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  RETURN jsonb_build_object(
    'open_shift', CASE WHEN v_shift IS NULL THEN NULL ELSE public.get_shift_report(v_shift) END,
    'payment_methods', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pm.id, 'name', pm.name, 'code', pm.code,
        'treasury_id', pm.treasury_id, 'sort_order', pm.sort_order
      ) ORDER BY pm.sort_order)
      FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.is_active = true AND pm.treasury_id IS NOT NULL
    ), '[]'::jsonb),
    'can_discount', public.pos_staff_can_discount(),
    'can_open_shift', public.is_owner_or_manager()
  );
END; $$;

-- finalize_sale: single atomic sale (ADR-0021) -------------------------------
CREATE OR REPLACE FUNCTION public.finalize_sale(
  p_items jsonb,
  p_tenders jsonb,
  p_discount jsonb DEFAULT NULL,
  p_order_note text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
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
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.orders
    WHERE restaurant_id = v_rest AND client_request_id = p_client_request_id;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'DUPLICATE_REQUEST';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  -- Discount authorization (Q-M5-3)
  IF p_discount IS NOT NULL AND p_discount <> 'null'::jsonb THEN
    IF NOT public.pos_staff_can_discount() THEN RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED'; END IF;
    v_disc_type := (p_discount->>'type')::public.discount_type;
    v_disc_value := (p_discount->>'value')::numeric;
    v_disc_reason := nullif(trim(coalesce(p_discount->>'reason', '')), '');
    IF v_disc_value IS NULL OR v_disc_value <= 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF v_disc_type = 'percent' AND v_disc_value > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF length(coalesce(v_disc_reason, '')) = 0 THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED'; END IF;
  END IF;

  -- Pass 1: validate items + compute subtotal (server authoritative)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
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

      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.modifier_options o
          JOIN public.menu_item_modifier_groups l ON l.modifier_group_id = o.group_id
          WHERE o.id = v_opt_id AND l.menu_item_id = v_item.id AND o.is_active = true
        ) THEN RAISE EXCEPTION 'INVALID_MODIFIERS'; END IF;
        SELECT v_unit + o.price_delta INTO v_unit
        FROM public.modifier_options o WHERE o.id = v_opt_id;
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

  -- Tender validation (R2: digital exact, change on cash only)
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    IF coalesce((v_tender->>'amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
    v_tender_sum := v_tender_sum + (v_tender->>'amount')::numeric;
    IF v_pm.code = 'cash' THEN
      v_cash_tender := v_cash_tender + (v_tender->>'amount')::numeric;
    ELSE
      v_non_cash := v_non_cash + (v_tender->>'amount')::numeric;
    END IF;
  END LOOP;

  IF v_tender_sum < v_total THEN RAISE EXCEPTION 'UNDERPAID'; END IF;
  v_cash_required := v_total - v_non_cash;
  IF v_cash_required < 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
  IF v_cash_tender < v_cash_required THEN RAISE EXCEPTION 'UNDERPAID'; END IF;
  v_change := v_cash_tender - v_cash_required;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, subtotal, discount_amount, total,
    discount_type, discount_value, discount_reason, order_note, client_request_id, created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', v_subtotal, v_discount_amt, v_total,
    v_disc_type, v_disc_value, v_disc_reason,
    nullif(trim(coalesce(p_order_note, '')), ''), p_client_request_id, v_staff, now()
  ) RETURNING id INTO v_order_id;

  -- Pass 2: insert lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_item FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    IF v_item.is_open_price THEN v_unit := (v_line->>'open_price')::numeric;
    ELSE v_unit := v_item.base_price; END IF;
    v_mod_summary := '';
    IF v_item.accepts_modifiers THEN
      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid
      LOOP
        SELECT v_unit + o.price_delta, v_mod_summary || CASE WHEN v_mod_summary = '' THEN '' ELSE ', ' END || o.name
        INTO v_unit, v_mod_summary
        FROM public.modifier_options o WHERE o.id = v_opt_id;
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
      FOR v_opt_id IN SELECT jsonb_array_elements_text(coalesce(v_line->'modifier_option_ids', '[]'::jsonb))::uuid
      LOOP
        INSERT INTO public.order_item_modifiers (order_item_id, modifier_option_id, group_name, option_name, price_delta)
        SELECT v_order_item_id, o.id, g.name, o.name, o.price_delta
        FROM public.modifier_options o JOIN public.modifier_groups g ON g.id = o.group_id
        WHERE o.id = v_opt_id;
      END LOOP;
    END IF;
    v_sort := v_sort + 1;
  END LOOP;

  -- Payments + ledger (R2: digital exact; change on cash only)
  v_remaining_due := v_total;
  v_change := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
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
    INSERT INTO public.order_payments (order_id, reference, payment_method_id, treasury_id, amount, change_given)
    VALUES (v_order_id, v_pay_ref, v_pm.id, v_pm.treasury_id, v_tender_amt, v_tender_change)
    RETURNING id INTO v_pay_id;

    INSERT INTO public.treasury_movements (
      restaurant_id, treasury_id, shift_id, amount, source,
      source_ref_type, source_ref_id, reference, created_by
    ) VALUES (
      v_rest, v_pm.treasury_id, v_shift, v_net,
      'pos_payment', 'order_payment', v_pay_id, v_pay_ref, v_staff
    );
  END LOOP;

  -- Kitchen ticket
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

    PERFORM public.log_audit_event(v_rest, 'kitchen.ticket_created', NULL, v_staff,
      'kitchen_ticket', v_kt_id, NULL, jsonb_build_object('reference', v_kt_ref));
  END IF;

  -- Print jobs (server intent — M7 executes)
  v_pj_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (restaurant_id, order_id, reference, kind, status, payload)
  VALUES (v_rest, v_order_id, v_pj_ref, 'receipt', 'pending',
    jsonb_build_object('order_reference', v_ord_ref, 'total', v_total));

  IF v_has_kitchen THEN
    v_pj_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
    INSERT INTO public.print_jobs (restaurant_id, order_id, reference, kind, status, payload)
    VALUES (v_rest, v_order_id, v_pj_ref, 'kitchen', 'pending',
      jsonb_build_object('order_reference', v_ord_ref, 'kitchen_ticket', v_kt_ref));
  END IF;

  PERFORM public.log_audit_event(v_rest, 'order.finalized', NULL, v_staff, 'order', v_order_id, NULL,
    jsonb_build_object('reference', v_ord_ref, 'total', v_total));
  PERFORM public.log_audit_event(v_rest, 'print.job_enqueued', NULL, v_staff, 'print_job', v_order_id, NULL, NULL);

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'reference', v_ord_ref,
    'subtotal', v_subtotal,
    'discount_amount', v_discount_amt,
    'total', v_total,
    'change', v_change,
    'kitchen_ticket_id', v_kt_id
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_pos_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sale(jsonb, jsonb, jsonb, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
