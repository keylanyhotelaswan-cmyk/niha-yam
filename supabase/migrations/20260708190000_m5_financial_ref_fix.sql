-- M5 patch: financial ref counter sync (prevents ORD-/PAY- collisions after
-- partial cleanup) + digital overpay guard in finalize_sale.

CREATE OR REPLACE FUNCTION public.financial_ref_table_max(
  p_restaurant_id uuid, p_ref_type text, p_prefix text
)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max bigint := 0; v_part bigint;
BEGIN
  IF p_ref_type = 'order' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.orders WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'payment' THEN
    SELECT coalesce(max(substring(op.reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE o.restaurant_id = p_restaurant_id AND op.reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.kitchen_tickets WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'print_job' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.print_jobs WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type IN ('shift', 'cash_drop', 'transfer', 'expense', 'variance', 'deposit', 'withdrawal') THEN
    IF p_ref_type = 'shift' THEN
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.shifts WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    ELSIF p_ref_type = 'expense' THEN
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.expenses WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    ELSE
      SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
      FROM public.treasury_transfers WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    END IF;
    v_max := coalesce(v_part, 0);
  END IF;
  RETURN coalesce(v_max, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.financial_ref_exists(
  p_restaurant_id uuid, p_ref_type text, p_reference text
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ref_type = 'order' THEN
    RETURN EXISTS (SELECT 1 FROM public.orders WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'payment' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND op.reference = p_reference
    );
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    RETURN EXISTS (SELECT 1 FROM public.kitchen_tickets WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'print_job' THEN
    RETURN EXISTS (SELECT 1 FROM public.print_jobs WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'shift' THEN
    RETURN EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSIF p_ref_type = 'expense' THEN
    RETURN EXISTS (SELECT 1 FROM public.expenses WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  ELSE
    RETURN EXISTS (SELECT 1 FROM public.treasury_transfers WHERE restaurant_id = p_restaurant_id AND reference = p_reference);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.next_financial_ref(
  p_restaurant_id uuid, p_ref_type text, p_prefix text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v bigint;
  v_ref text;
  v_max bigint;
  v_guard int := 0;
BEGIN
  v_max := public.financial_ref_table_max(p_restaurant_id, p_ref_type, p_prefix);

  INSERT INTO public.financial_ref_counters (restaurant_id, ref_type, current_value)
  VALUES (p_restaurant_id, p_ref_type, greatest(1, v_max + 1))
  ON CONFLICT (restaurant_id, ref_type)
  DO UPDATE SET current_value = GREATEST(
    public.financial_ref_counters.current_value + 1,
    v_max + 1
  )
  RETURNING current_value INTO v;

  v_ref := p_prefix || '-' || lpad(v::text, 6, '0');

  WHILE public.financial_ref_exists(p_restaurant_id, p_ref_type, v_ref) LOOP
    v_guard := v_guard + 1;
    IF v_guard > 1000 THEN RAISE EXCEPTION 'REFERENCE_EXHAUSTED'; END IF;
    UPDATE public.financial_ref_counters
    SET current_value = current_value + 1
    WHERE restaurant_id = p_restaurant_id AND ref_type = p_ref_type
    RETURNING current_value INTO v;
    v_ref := p_prefix || '-' || lpad(v::text, 6, '0');
  END LOOP;

  RETURN v_ref;
END; $$;

-- Sync counters once for existing restaurants (fixes live DB after partial cleanup).
DO $$
DECLARE r record; rt record;
BEGIN
  FOR r IN SELECT id FROM public.restaurants LOOP
    FOR rt IN SELECT * FROM (VALUES
      ('order', 'ORD'), ('payment', 'PAY'), ('kitchen_ticket', 'KT'), ('print_job', 'PJ'),
      ('shift', 'SH'), ('cash_drop', 'CD'), ('transfer', 'TR'), ('expense', 'EXP'), ('variance', 'VR')
    ) AS t(ref_type, prefix) LOOP
      INSERT INTO public.financial_ref_counters (restaurant_id, ref_type, current_value)
      VALUES (r.id, rt.ref_type, public.financial_ref_table_max(r.id, rt.ref_type, rt.prefix))
      ON CONFLICT (restaurant_id, ref_type)
      DO UPDATE SET current_value = GREATEST(
        public.financial_ref_counters.current_value,
        public.financial_ref_table_max(r.id, rt.ref_type, rt.prefix)
      );
    END LOOP;
  END LOOP;
END $$;

-- finalize_sale: reject digital overpay (R2 exact digital) -------------------
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
    IF v_existing IS NOT NULL THEN RAISE EXCEPTION 'DUPLICATE_REQUEST'; END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;
  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  IF p_discount IS NOT NULL AND p_discount <> 'null'::jsonb THEN
    IF NOT public.pos_staff_can_discount() THEN RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED'; END IF;
    v_disc_type := (p_discount->>'type')::public.discount_type;
    v_disc_value := (p_discount->>'value')::numeric;
    v_disc_reason := nullif(trim(coalesce(p_discount->>'reason', '')), '');
    IF v_disc_value IS NULL OR v_disc_value <= 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF v_disc_type = 'percent' AND v_disc_value > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF length(coalesce(v_disc_reason, '')) = 0 THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED'; END IF;
  END IF;

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
  v_remaining_due := v_total;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
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
    restaurant_id, reference, shift_id, status, subtotal, discount_amount, total,
    discount_type, discount_value, discount_reason, order_note, client_request_id, created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', v_subtotal, v_discount_amt, v_total,
    v_disc_type, v_disc_value, v_disc_reason,
    nullif(trim(coalesce(p_order_note, '')), ''), p_client_request_id, v_staff, now()
  ) RETURNING id INTO v_order_id;

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

NOTIFY pgrst, 'reload schema';
