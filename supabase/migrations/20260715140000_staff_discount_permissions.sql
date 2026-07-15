-- Staff discount permissions: persist + enforce (edit → save → reload → apply)

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS discount_permissions jsonb;

COMMENT ON COLUMN public.staff.discount_permissions IS
  'Per-staff discount capability override. NULL = role defaults. Keys: manual, typeAmount, typePercent, maxAmount, maxPercent, canEdit, canRemove.';

CREATE OR REPLACE FUNCTION public.m5_normalize_discount_permissions(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_manual boolean;
  v_type_amount boolean;
  v_type_percent boolean;
  v_max_amount numeric;
  v_max_percent numeric;
  v_can_edit boolean;
  v_can_remove boolean;
BEGIN
  IF p IS NULL OR p = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  v_manual := coalesce((p->>'manual')::boolean, false);
  v_type_amount := coalesce((p->>'typeAmount')::boolean, false);
  v_type_percent := coalesce((p->>'typePercent')::boolean, false);
  v_can_edit := coalesce((p->>'canEdit')::boolean, false);
  v_can_remove := coalesce((p->>'canRemove')::boolean, false);

  IF p ? 'maxAmount' AND nullif(trim(coalesce(p->>'maxAmount', '')), '') IS NOT NULL THEN
    v_max_amount := (p->>'maxAmount')::numeric;
    IF v_max_amount < 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
  ELSE
    v_max_amount := NULL;
  END IF;

  IF p ? 'maxPercent' AND nullif(trim(coalesce(p->>'maxPercent', '')), '') IS NOT NULL THEN
    v_max_percent := (p->>'maxPercent')::numeric;
    IF v_max_percent < 0 OR v_max_percent > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
  ELSE
    v_max_percent := NULL;
  END IF;

  IF v_manual AND NOT v_type_amount AND NOT v_type_percent THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT';
  END IF;

  RETURN jsonb_build_object(
    'manual', v_manual,
    'typeAmount', v_type_amount,
    'typePercent', v_type_percent,
    'maxAmount', to_jsonb(v_max_amount),
    'maxPercent', to_jsonb(v_max_percent),
    'canEdit', v_can_edit,
    'canRemove', v_can_remove
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.m5_role_default_discount_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.staff_branches sb
      WHERE sb.staff_id = public.auth_staff_id()
        AND sb.role IN ('owner', 'manager')
    ) THEN jsonb_build_object(
      'manual', true,
      'typeAmount', true,
      'typePercent', true,
      'maxAmount', null,
      'maxPercent', null,
      'canEdit', true,
      'canRemove', true
    )
    ELSE jsonb_build_object(
      'manual', false,
      'typeAmount', false,
      'typePercent', false,
      'maxAmount', null,
      'maxPercent', null,
      'canEdit', false,
      'canRemove', false
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.pos_staff_discount_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT public.m5_normalize_discount_permissions(s.discount_permissions)
      FROM public.staff s
      WHERE s.id = public.auth_staff_id()
        AND s.discount_permissions IS NOT NULL
    ),
    public.m5_role_default_discount_permissions()
  );
$$;

CREATE OR REPLACE FUNCTION public.pos_staff_can_discount()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((public.pos_staff_discount_permissions()->>'manual')::boolean, false);
$$;

CREATE OR REPLACE FUNCTION public.assert_discount_payload_allowed(p_discount jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg jsonb := public.pos_staff_discount_permissions();
  v_type text;
  v_value numeric;
BEGIN
  IF p_discount IS NULL OR p_discount = 'null'::jsonb THEN
    RETURN;
  END IF;

  IF NOT coalesce((v_cfg->>'manual')::boolean, false) THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
  END IF;

  v_type := p_discount->>'type';
  v_value := (p_discount->>'value')::numeric;

  IF v_type = 'amount' AND NOT coalesce((v_cfg->>'typeAmount')::boolean, false) THEN
    RAISE EXCEPTION 'DISCOUNT_TYPE_NOT_ALLOWED';
  END IF;
  IF v_type = 'percent' AND NOT coalesce((v_cfg->>'typePercent')::boolean, false) THEN
    RAISE EXCEPTION 'DISCOUNT_TYPE_NOT_ALLOWED';
  END IF;

  IF v_type = 'amount'
     AND v_cfg->>'maxAmount' IS NOT NULL
     AND v_cfg->>'maxAmount' <> 'null'
     AND v_value > (v_cfg->>'maxAmount')::numeric THEN
    RAISE EXCEPTION 'DISCOUNT_MAX_AMOUNT';
  END IF;

  IF v_type = 'percent'
     AND v_cfg->>'maxPercent' IS NOT NULL
     AND v_cfg->>'maxPercent' <> 'null'
     AND v_value > (v_cfg->>'maxPercent')::numeric THEN
    RAISE EXCEPTION 'DISCOUNT_MAX_PERCENT';
  END IF;
END;
$$;

-- update_staff: persist discount permissions
DROP FUNCTION IF EXISTS public.update_staff(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_staff(
  p_staff_id uuid,
  p_display_name text,
  p_branch_assignments jsonb,
  p_discount_permissions jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_actor_id uuid;
  v_assignment jsonb;
  v_owner_count int;
  v_disc jsonb;
BEGIN
  v_actor_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF v_actor_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = p_staff_id AND sb.role = 'owner'
  ) THEN
    SELECT count(*)::int INTO v_owner_count
    FROM public.staff_branches sb
    JOIN public.staff s ON s.id = sb.staff_id
    WHERE s.restaurant_id = v_restaurant_id
      AND sb.role = 'owner'
      AND s.is_active = true;

    IF v_owner_count <= 1 AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_branch_assignments) elem
      WHERE (elem ->> 'role') = 'owner'
    ) THEN
      RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
    END IF;
  END IF;

  IF p_discount_permissions IS NOT NULL THEN
    v_disc := public.m5_normalize_discount_permissions(p_discount_permissions);
  END IF;

  UPDATE public.staff
  SET
    display_name = trim(p_display_name),
    discount_permissions = CASE
      WHEN p_discount_permissions IS NOT NULL THEN v_disc
      ELSE discount_permissions
    END,
    updated_at = now()
  WHERE id = p_staff_id;

  DELETE FROM public.staff_branches WHERE staff_id = p_staff_id;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(p_branch_assignments)
  LOOP
    INSERT INTO public.staff_branches (staff_id, branch_id, role)
    VALUES (
      p_staff_id,
      (v_assignment ->> 'branch_id')::uuid,
      (v_assignment ->> 'role')::public.staff_role
    );
  END LOOP;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.updated',
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    jsonb_build_object(
      'display_name', trim(p_display_name),
      'discount_permissions', v_disc
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.list_staff();

CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  is_active boolean,
  branches jsonb,
  created_at timestamptz,
  discount_permissions jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    s.username,
    s.display_name,
    s.is_active,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'branch_id', sb.branch_id,
            'role', sb.role,
            'branch_name', b.name
          )
        )
        FROM public.staff_branches sb
        JOIN public.branches b ON b.id = sb.branch_id
        WHERE sb.staff_id = s.id
      ),
      '[]'::jsonb
    ),
    s.created_at,
    s.discount_permissions
  FROM public.staff s
  WHERE s.restaurant_id = public.auth_restaurant_id()
  ORDER BY s.display_name;
END;
$$;

-- get_pos_context: expose full discount config
CREATE OR REPLACE FUNCTION public.get_pos_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift uuid;
  v_pending jsonb;
  v_next jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT id INTO v_shift FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  v_pending := public.list_pending_handovers();
  SELECT x INTO v_next FROM jsonb_array_elements(v_pending) AS t(x)
  WHERE (x->>'kind') = 'to_next_shift' LIMIT 1;

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
    'delivery_drivers', public.list_delivery_drivers(true),
    'operational_treasuries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'code',
          CASE
            WHEN t.is_shift_drawer THEN 'drawer'
            WHEN pm.code IS NOT NULL THEN pm.code
            ELSE 'other'
          END,
        'balance', CASE
          WHEN v_shift IS NOT NULL THEN public.m5b_operational_treasury_balance(t.id, v_shift)
          ELSE public.treasury_balance(t.id)
        END,
        'approved_balance', public.treasury_balance(t.id)
      ) ORDER BY t.sort_order)
      FROM public.treasuries t
      LEFT JOIN public.payment_methods pm ON pm.treasury_id = t.id AND pm.restaurant_id = v_rest
      WHERE t.restaurant_id = v_rest AND t.is_active = true
        AND (t.is_shift_drawer = true OR pm.code IN ('instapay', 'ewallet'))
    ), '[]'::jsonb),
    'operational_drawer_balance', (
      SELECT CASE WHEN v_shift IS NULL OR t.id IS NULL THEN NULL
        ELSE public.m5b_operational_treasury_balance(t.id, v_shift) END
      FROM public.treasuries t
      WHERE t.restaurant_id = v_rest AND t.is_shift_drawer = true AND t.is_active = true
      LIMIT 1
    ),
    'can_discount', public.pos_staff_can_discount(),
    'discount_permissions', public.pos_staff_discount_permissions(),
    'can_open_shift', v_shift IS NULL,
    'can_close_shift', v_shift IS NOT NULL,
    'can_approve_collections', public.is_owner_or_manager(),
    'can_manage_drivers', public.is_owner_or_manager(),
    'pending_handovers', v_pending,
    'pending_next_shift_handover', v_next,
    'has_pending_handover', public.restaurant_has_pending_handover(v_rest)
  );
END;
$$;

-- Enforce caps inside apply_order_discount
CREATE OR REPLACE FUNCTION public.apply_order_discount(
  p_order_id uuid,
  p_discount jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_disc_type public.discount_type;
  v_disc_value numeric;
  v_disc_reason text;
  v_disc_amt numeric := 0;
  v_new_total numeric;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'FREE_EDIT_BLOCKED_AFTER_APPROVE';
  END IF;

  IF p_discount IS NULL OR p_discount = 'null'::jsonb THEN
    IF NOT coalesce((public.pos_staff_discount_permissions()->>'canRemove')::boolean, false)
       AND coalesce(v_order.discount_amount, 0) > 0 THEN
      RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED';
    END IF;
    v_disc_amt := 0;
    v_disc_type := NULL;
    v_disc_value := NULL;
    v_disc_reason := NULL;
  ELSE
    PERFORM public.assert_discount_payload_allowed(p_discount);
    v_disc_type := (p_discount->>'type')::public.discount_type;
    v_disc_value := (p_discount->>'value')::numeric;
    v_disc_reason := nullif(trim(coalesce(p_discount->>'reason', '')), '');
    IF v_disc_value IS NULL OR v_disc_value <= 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF v_disc_type = 'percent' AND v_disc_value > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF length(coalesce(v_disc_reason, '')) = 0 THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED'; END IF;

    IF v_disc_type = 'percent' THEN
      v_disc_amt := round(v_order.subtotal * v_disc_value / 100, 2);
    ELSE
      v_disc_amt := v_disc_value;
    END IF;
    IF v_disc_amt > v_order.subtotal THEN v_disc_amt := v_order.subtotal; END IF;
  END IF;

  v_new_total := greatest(v_order.subtotal - v_disc_amt, 0);

  UPDATE public.orders SET
    discount_amount = v_disc_amt,
    discount_type = v_disc_type,
    discount_value = v_disc_value,
    discount_reason = v_disc_reason,
    total = v_new_total,
    last_edited_by = v_staff,
    last_edited_at = now()
  WHERE id = p_order_id;

  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  PERFORM public.record_order_event(
    p_order_id, 'order.total_changed', 'order', p_order_id,
    jsonb_build_object(
      'from_total', v_order.total,
      'to_total', v_new_total,
      'discount_amount', v_disc_amt,
      'discount_type', v_disc_type::text,
      'discount_value', v_disc_value
    )
  );

  PERFORM public.log_audit_event(
    v_rest, 'order.edited', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('discount_amount', v_disc_amt, 'discount_type', v_disc_type::text)
  );

  RETURN public.m5c_order_money_snapshot(p_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pos_staff_discount_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_discount_payload_allowed(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff(uuid, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Enforce discount type/max caps in finalize_sale
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
    PERFORM public.assert_discount_payload_allowed(p_discount);
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


NOTIFY pgrst, 'reload schema';
