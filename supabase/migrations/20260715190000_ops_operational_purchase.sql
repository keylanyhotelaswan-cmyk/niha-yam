-- Operational purchase capability + ops financial UX support.
-- Does not change PURA money/inventory posting logic — only authorization gates
-- and read helpers so trusted cashiers can post via pur_* with a staff flag.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS can_operational_purchase boolean;

COMMENT ON COLUMN public.staff.can_operational_purchase IS
  'NULL = role default (owner/manager true, others false). Explicit true/false overrides.';

-- ---------------------------------------------------------------------------
-- Capability helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_staff_can_operational_purchase()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid := public.auth_staff_id();
  v_flag boolean;
BEGIN
  IF v_staff IS NULL THEN RETURN false; END IF;

  SELECT s.can_operational_purchase INTO v_flag
  FROM public.staff s
  WHERE s.id = v_staff AND s.is_active;

  IF NOT FOUND THEN RETURN false; END IF;

  IF v_flag IS NOT NULL THEN
    RETURN v_flag;
  END IF;

  -- Role default when NULL
  RETURN public.is_owner_or_manager();
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_require_operational_purchase()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL OR NOT public.pur_staff_can_operational_purchase() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  RETURN v_rest;
END;
$$;

-- ---------------------------------------------------------------------------
-- Internal inventory glue (no separate auth — only called from pur_* DEFINITER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_post_receive_for_purchase(
  p_restaurant_id uuid,
  p_staff_id uuid,
  p_ingredient_id uuid,
  p_qty numeric,
  p_uom_id uuid,
  p_source_id uuid,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc uuid;
  v_qty_base numeric;
  v_ref text;
  v_id uuid;
  v_on_hand numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients i
    WHERE i.id = p_ingredient_id AND i.restaurant_id = p_restaurant_id
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_loc := public.inv_ensure_default_location(p_restaurant_id);
  SELECT public.rc_convert_qty(
    p_restaurant_id, p_qty, p_uom_id,
    (SELECT base_uom_id FROM public.ingredients WHERE id = p_ingredient_id)
  ) INTO v_qty_base;

  v_ref := coalesce(nullif(trim(p_reference), ''), public.inv_next_reference(p_restaurant_id, 'RECEIVE'));

  INSERT INTO public.stock_movements (
    restaurant_id, ingredient_id, location_id, lot_id,
    movement_type, direction, qty, uom_id, qty_base,
    reference, source_type, source_id, reason, created_by
  ) VALUES (
    p_restaurant_id, p_ingredient_id, v_loc, NULL,
    'receive', 'in', p_qty, p_uom_id, v_qty_base,
    v_ref, 'purchase_line', p_source_id, NULL, p_staff_id
  )
  RETURNING id INTO v_id;

  v_on_hand := public.inv_on_hand(p_restaurant_id, p_ingredient_id, v_loc);

  PERFORM public.log_audit_event(
    p_restaurant_id, 'inventory.movement_posted', NULL, p_staff_id,
    'stock_movement', v_id, NULL,
    jsonb_build_object(
      'type', 'receive', 'ingredient_id', p_ingredient_id,
      'qty_base', v_qty_base, 'direction', 'in', 'reference', v_ref,
      'via', 'purchase'
    )
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'reference', v_ref,
    'on_hand_after', v_on_hand,
    'negative_stock_warning', v_on_hand < 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_reverse_for_purchase(
  p_restaurant_id uuid,
  p_staff_id uuid,
  p_movement_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.stock_movements%ROWTYPE;
  v_dir public.stock_movement_direction;
  v_id uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_m
  FROM public.stock_movements
  WHERE id = p_movement_id AND restaurant_id = p_restaurant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_m.source_type IS DISTINCT FROM 'purchase_line' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements r WHERE r.reverses_movement_id = p_movement_id
  ) THEN RAISE EXCEPTION 'ALREADY_REVERSED'; END IF;
  IF v_m.movement_type = 'reverse' THEN RAISE EXCEPTION 'CANNOT_REVERSE_REVERSE'; END IF;

  v_dir := CASE WHEN v_m.direction = 'in' THEN 'out'::public.stock_movement_direction
                ELSE 'in'::public.stock_movement_direction END;
  v_ref := public.inv_next_reference(p_restaurant_id, 'REVERSE');

  INSERT INTO public.stock_movements (
    restaurant_id, ingredient_id, location_id, lot_id,
    movement_type, direction, qty, uom_id, qty_base,
    reference, source_type, source_id, reason, created_by, reverses_movement_id
  ) VALUES (
    p_restaurant_id, v_m.ingredient_id, v_m.location_id, v_m.lot_id,
    'reverse', v_dir, v_m.qty, v_m.uom_id, v_m.qty_base,
    v_ref, v_m.source_type, v_m.source_id, nullif(trim(p_reason), ''), p_staff_id, p_movement_id
  )
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    p_restaurant_id, 'inventory.movement_reversed', NULL, p_staff_id,
    'stock_movement', v_id, NULL,
    jsonb_build_object('reverses', p_movement_id, 'via', 'purchase')
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'reference', v_ref,
    'reverses_movement_id', p_movement_id,
    'on_hand_after', public.inv_on_hand(p_restaurant_id, v_m.ingredient_id, v_m.location_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ops list helpers (active only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_list_ops_ingredients()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
BEGIN
  PERFORM public.rc_ensure_default_uoms(v_rest);
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name_ar)
    FROM (
      SELECT
        i.id,
        i.name_ar,
        i.code,
        i.base_uom_id,
        u.code AS base_uom_code,
        u.name_ar AS base_uom_name_ar,
        i.is_active
      FROM public.ingredients i
      JOIN public.uoms u ON u.id = i.base_uom_id
      WHERE i.restaurant_id = v_rest AND i.is_active
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_list_ops_suppliers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.name_ar)
    FROM (
      SELECT id, name_ar, code, is_active
      FROM public.suppliers
      WHERE restaurant_id = v_rest AND is_active
    ) s
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Rebind purchase post/reverse to capability gate + internal inventory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_post_direct_cash_purchase(
  p_treasury_id uuid,
  p_source_kind text,
  p_supplier_id uuid,
  p_direct_label text,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
  v_staff uuid := public.auth_staff_id();
  v_ref text;
  v_purchase_id uuid;
  v_total numeric(14, 2) := 0;
  v_line jsonb;
  v_line_id uuid;
  v_ingredient_id uuid;
  v_qty numeric;
  v_uom_id uuid;
  v_unit_price numeric;
  v_line_total numeric(14, 2);
  v_line_notes text;
  v_mov jsonb;
  v_mov_id uuid;
  v_label text;
  v_lines_out jsonb := '[]'::jsonb;
BEGIN
  IF p_source_kind IS NULL OR p_source_kind NOT IN ('supplier', 'direct') THEN
    RAISE EXCEPTION 'INVALID_SOURCE';
  END IF;
  IF p_treasury_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.treasuries t
    WHERE t.id = p_treasury_id AND t.restaurant_id = v_rest AND t.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'LINES_REQUIRED';
  END IF;

  IF p_source_kind = 'direct' THEN
    v_label := nullif(trim(coalesce(p_direct_label, '')), '');
    IF v_label IS NULL THEN RAISE EXCEPTION 'DIRECT_LABEL_REQUIRED'; END IF;
    IF p_supplier_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
  ELSE
    IF p_supplier_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest AND s.is_active
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_REQUIRED';
    END IF;
    v_label := NULL;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_ingredient_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_uom_id := (v_line->>'uom_id')::uuid;
    v_unit_price := coalesce((v_line->>'unit_price')::numeric, -1);
    IF v_ingredient_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.ingredients i
      WHERE i.id = v_ingredient_id AND i.restaurant_id = v_rest AND i.is_active
    ) THEN
      RAISE EXCEPTION 'INGREDIENT_REQUIRED';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    IF v_uom_id IS NULL THEN RAISE EXCEPTION 'INVALID_UOM'; END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_line_total := round(v_qty * v_unit_price, 2);
    IF v_line_total < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_total := v_total + v_line_total;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF public.treasury_balance(p_treasury_id) < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'purchase', 'PUR');

  INSERT INTO public.purchases (
    restaurant_id, reference, source_kind, supplier_id, direct_label,
    payment_method, currency_code, treasury_id, total_amount, notes,
    status, created_by, approved_by, approved_at, executed_at
  ) VALUES (
    v_rest, v_ref, p_source_kind,
    CASE WHEN p_source_kind = 'supplier' THEN p_supplier_id ELSE NULL END,
    v_label,
    'cash', 'EGP', p_treasury_id, v_total,
    nullif(trim(coalesce(p_notes, '')), ''),
    'executed', v_staff, v_staff, now(), now()
  )
  RETURNING id INTO v_purchase_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_ingredient_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_uom_id := (v_line->>'uom_id')::uuid;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_line_total := round(v_qty * v_unit_price, 2);
    v_line_notes := nullif(trim(coalesce(v_line->>'notes', '')), '');

    INSERT INTO public.purchase_lines (
      purchase_id, restaurant_id, ingredient_id, qty, uom_id,
      unit_price, line_total, notes
    ) VALUES (
      v_purchase_id, v_rest, v_ingredient_id, v_qty, v_uom_id,
      v_unit_price, v_line_total, v_line_notes
    )
    RETURNING id INTO v_line_id;

    v_mov := public.inv_post_receive_for_purchase(
      v_rest, v_staff, v_ingredient_id, v_qty, v_uom_id, v_line_id, v_ref
    );
    v_mov_id := (v_mov->>'id')::uuid;
    UPDATE public.purchase_lines SET stock_movement_id = v_mov_id WHERE id = v_line_id;

    v_lines_out := v_lines_out || jsonb_build_array(jsonb_build_object(
      'id', v_line_id,
      'ingredient_id', v_ingredient_id,
      'qty', v_qty,
      'uom_id', v_uom_id,
      'unit_price', v_unit_price,
      'line_total', v_line_total,
      'stock_movement_id', v_mov_id
    ));
  END LOOP;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, p_treasury_id, -v_total, 'purchase'::public.movement_source,
    'purchase', v_purchase_id, v_ref, v_staff
  );

  PERFORM public.log_audit_event(
    v_rest, 'purchase.direct_posted', NULL, v_staff,
    'purchase', v_purchase_id, NULL,
    jsonb_build_object(
      'reference', v_ref,
      'source_kind', p_source_kind,
      'total_amount', v_total,
      'treasury_id', p_treasury_id,
      'supplier_id', p_supplier_id,
      'direct_label', v_label
    )
  );

  RETURN jsonb_build_object(
    'id', v_purchase_id,
    'reference', v_ref,
    'total_amount', v_total,
    'status', 'executed',
    'source_kind', p_source_kind,
    'lines', v_lines_out
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_reverse_direct_cash_purchase(
  p_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
  v_staff uuid := public.auth_staff_id();
  v_p public.purchases%ROWTYPE;
  v_line public.purchase_lines%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_p FROM public.purchases
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_p.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  FOR v_line IN
    SELECT * FROM public.purchase_lines
    WHERE purchase_id = p_id AND restaurant_id = v_rest
  LOOP
    IF v_line.stock_movement_id IS NOT NULL THEN
      PERFORM public.inv_reverse_for_purchase(
        v_rest, v_staff, v_line.stock_movement_id, trim(p_reason)
      );
    END IF;
  END LOOP;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, v_p.treasury_id, v_p.total_amount, 'purchase'::public.movement_source,
    'purchase_reversal', p_id, v_p.reference, v_staff
  );

  UPDATE public.purchases SET
    status = 'reversed',
    reversed_by = v_staff,
    reversed_at = now(),
    reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(
    v_rest, 'purchase.direct_reversed', NULL, v_staff,
    'purchase', p_id, NULL,
    jsonb_build_object('reason', trim(p_reason), 'reference', v_p.reference)
  );

  RETURN jsonb_build_object(
    'id', p_id,
    'reference', v_p.reference,
    'status', 'reversed'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- update_staff: persist can_operational_purchase
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_staff(uuid, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.update_staff(
  p_staff_id uuid,
  p_display_name text,
  p_branch_assignments jsonb,
  p_discount_permissions jsonb DEFAULT NULL,
  p_can_operational_purchase boolean DEFAULT NULL,
  p_set_operational_purchase boolean DEFAULT false
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
    can_operational_purchase = CASE
      WHEN p_set_operational_purchase THEN p_can_operational_purchase
      ELSE can_operational_purchase
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
      'discount_permissions', v_disc,
      'can_operational_purchase', CASE
        WHEN p_set_operational_purchase THEN to_jsonb(p_can_operational_purchase)
        ELSE NULL
      END
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
  discount_permissions jsonb,
  can_operational_purchase boolean
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
    s.discount_permissions,
    s.can_operational_purchase
  FROM public.staff s
  WHERE s.restaurant_id = public.auth_restaurant_id()
  ORDER BY s.display_name;
END;
$$;

-- get_pos_context: expose flag
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
    'can_operational_purchase', public.pur_staff_can_operational_purchase(),
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

GRANT EXECUTE ON FUNCTION public.pur_staff_can_operational_purchase() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_list_ops_ingredients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_list_ops_suppliers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff(uuid, text, jsonb, jsonb, boolean, boolean) TO authenticated;
