-- PURA: Suppliers master + Purchase Source + direct cash purchase
-- → inventory receive (INVA) + treasury cash settlement (F1 glue).
-- No AP / credit. No expense path for stock. No standard_cost auto-update.
-- Testing-first capability slice — see docs/suppliers-purchasing-plan.md §4 PURA.

-- ---------------------------------------------------------------------------
-- Audit allowlist
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS chk_audit_log_m1_actions;
ALTER TABLE public.audit_log ADD CONSTRAINT chk_audit_log_m1_actions CHECK (
  action IN (
    'auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset_requested', 'auth.signup_completed',
    'auth.pin_login', 'auth.pin_login_failed',
    'staff.invited', 'staff.created', 'staff.updated', 'staff.deactivated', 'staff.reactivated',
    'staff.password_changed', 'staff.pin_set', 'staff.pin_verify_failed', 'staff.owner_bootstrapped',
    'menu.category_created', 'menu.category_updated', 'menu.category_status_changed',
    'menu.item_created', 'menu.item_updated', 'menu.item_status_changed',
    'menu.modifier_group_created', 'menu.modifier_group_updated', 'menu.modifier_group_status_changed',
    'menu.modifier_option_created', 'menu.modifier_option_updated', 'menu.modifier_option_status_changed',
    'menu.item_modifiers_linked',
    'treasury.created', 'treasury.updated', 'treasury.status_changed',
    'payment_method.updated', 'payment_method.mapping_changed', 'payment_method.status_changed',
    'shift.opened', 'shift.closed',
    'transfer.created', 'transfer.approved', 'transfer.rejected', 'transfer.executed', 'transfer.reversed',
    'cash_drop.executed',
    'expense.created', 'expense.approved', 'expense.rejected', 'expense.executed', 'expense.reversed',
    'adjustment.created', 'adjustment.approved', 'adjustment.rejected', 'adjustment.executed', 'adjustment.reversed',
    'order.finalized', 'order.created', 'order.amended', 'order.fulfillment_updated', 'order.cancelled',
    'order.collection_recorded', 'order.collection_approved', 'order.collection_rejected', 'order.collection_reversed',
    'order.reprinted', 'order.edited', 'order.review_flagged', 'order.review_cleared',
    'order.driver_assigned', 'order.driver_changed',
    'kitchen.ticket_created', 'print.job_enqueued',
    'print.job_claimed', 'print.job_completed', 'print.job_failed', 'print.job_retried',
    'print.job_cancelled', 'print.job_again', 'print.test_enqueued',
    'printer.created', 'printer.updated', 'printer.status_changed',
    'print_bridge.heartbeat',
    'customer.created', 'customer.updated',
    'delivery_driver.created', 'delivery_driver.updated',
    'recipes.uom_created', 'recipes.uom_conversion_upserted',
    'recipes.ingredient_upserted', 'recipes.ingredient_cost_changed',
    'recipes.recipe_upserted', 'recipes.recipe_status_changed',
    'inventory.location_upserted', 'inventory.movement_posted', 'inventory.movement_reversed',
    'inventory.settings_upserted',
    'handover.created', 'handover.received', 'handover.rejected', 'handover.re_requested',
    'ops_feedback.created', 'ops_feedback.status',
    'purchase.supplier_upserted', 'purchase.supplier_status_changed',
    'purchase.direct_posted', 'purchase.direct_reversed'
  )
);

-- ---------------------------------------------------------------------------
-- Ledger taxonomy: purchase outflow (not expense)
-- ---------------------------------------------------------------------------
ALTER TYPE public.movement_source ADD VALUE IF NOT EXISTS 'purchase';

-- ---------------------------------------------------------------------------
-- Suppliers master
-- ---------------------------------------------------------------------------
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  code text,
  name_ar text NOT NULL,
  name_en text,
  phone text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_suppliers_name CHECK (length(trim(name_ar)) > 0)
);

CREATE UNIQUE INDEX uq_suppliers_code
  ON public.suppliers (restaurant_id, lower(code))
  WHERE code IS NOT NULL AND length(trim(code)) > 0;
CREATE INDEX idx_suppliers_restaurant ON public.suppliers (restaurant_id, is_active, name_ar);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Purchases (PURA: cash only — no AP)
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  source_kind text NOT NULL,
  supplier_id uuid REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  direct_label text,
  payment_method text NOT NULL DEFAULT 'cash',
  currency_code text NOT NULL DEFAULT 'EGP',
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  total_amount numeric(14, 2) NOT NULL,
  notes text,
  status public.fin_status NOT NULL DEFAULT 'executed',
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_at timestamptz,
  executed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_purchases_reference UNIQUE (restaurant_id, reference),
  CONSTRAINT chk_purchases_source_kind CHECK (source_kind IN ('supplier', 'direct')),
  CONSTRAINT chk_purchases_payment_method CHECK (payment_method = 'cash'),
  CONSTRAINT chk_purchases_currency CHECK (currency_code = 'EGP'),
  CONSTRAINT chk_purchases_total_positive CHECK (total_amount > 0),
  CONSTRAINT chk_purchases_source_xor CHECK (
    (source_kind = 'supplier' AND supplier_id IS NOT NULL AND (direct_label IS NULL OR length(trim(direct_label)) = 0))
    OR
    (source_kind = 'direct' AND supplier_id IS NULL AND direct_label IS NOT NULL AND length(trim(direct_label)) > 0)
  )
);

CREATE INDEX idx_purchases_restaurant ON public.purchases (restaurant_id, created_at DESC);
CREATE INDEX idx_purchases_status ON public.purchases (restaurant_id, status);
CREATE INDEX idx_purchases_supplier ON public.purchases (supplier_id)
  WHERE supplier_id IS NOT NULL;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchases_select ON public.purchases FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE TABLE public.purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients (id) ON DELETE RESTRICT,
  qty numeric(14, 4) NOT NULL,
  uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  unit_price numeric(14, 4) NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  notes text,
  stock_movement_id uuid REFERENCES public.stock_movements (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_purchase_lines_qty CHECK (qty > 0),
  CONSTRAINT chk_purchase_lines_unit_price CHECK (unit_price >= 0),
  CONSTRAINT chk_purchase_lines_total CHECK (line_total >= 0)
);

CREATE INDEX idx_purchase_lines_purchase ON public.purchase_lines (purchase_id);
CREATE INDEX idx_purchase_lines_ingredient ON public.purchase_lines (ingredient_id);

ALTER TABLE public.purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_lines_select ON public.purchase_lines FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Supplier RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_list_suppliers(p_active_only boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(s)::jsonb ORDER BY s.name_ar)
    FROM (
      SELECT id, code, name_ar, name_en, phone, notes, is_active, created_at, updated_at
      FROM public.suppliers
      WHERE restaurant_id = v_rest
        AND (NOT p_active_only OR is_active)
    ) s
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_upsert_supplier(
  p_id uuid,
  p_name_ar text,
  p_name_en text DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_id uuid;
  v_code text := nullif(trim(coalesce(p_code, '')), '');
BEGIN
  IF length(trim(coalesce(p_name_ar, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.suppliers (
      restaurant_id, code, name_ar, name_en, phone, notes, is_active, created_by
    ) VALUES (
      v_rest, v_code, trim(p_name_ar),
      nullif(trim(coalesce(p_name_en, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      coalesce(p_is_active, true), v_staff
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.suppliers SET
      code = v_code,
      name_ar = trim(p_name_ar),
      name_en = nullif(trim(coalesce(p_name_en, '')), ''),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      is_active = coalesce(p_is_active, is_active)
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;

  PERFORM public.log_audit_event(
    v_rest, 'purchase.supplier_upserted', NULL, v_staff,
    'supplier', v_id, NULL,
    jsonb_build_object('name_ar', trim(p_name_ar), 'code', v_code)
  );

  RETURN (
    SELECT row_to_json(s)::jsonb FROM (
      SELECT id, code, name_ar, name_en, phone, notes, is_active, created_at, updated_at
      FROM public.suppliers WHERE id = v_id
    ) s
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_set_supplier_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
BEGIN
  UPDATE public.suppliers SET is_active = p_active
  WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.log_audit_event(
    v_rest, 'purchase.supplier_status_changed', NULL, v_staff,
    'supplier', p_id, NULL, jsonb_build_object('is_active', p_active)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Direct cash purchase: post (inventory receive + treasury purchase movement)
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
  v_rest uuid := public.m4_require_manager();
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

  -- Validate lines + sum totals first
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

    -- INVA receive only — qty, no valuation / no standard_cost
    v_mov := public.inv_post_movement(
      v_ingredient_id,
      'receive'::public.stock_movement_type,
      v_qty,
      v_uom_id,
      NULL,
      NULL,
      NULL,
      'purchase_line',
      v_line_id,
      NULL,
      v_ref
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

  -- F1 treasury settle: append-only purchase source (not expense)
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
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_p public.purchases%ROWTYPE;
  v_line public.purchase_lines%ROWTYPE;
  v_rev jsonb;
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
      v_rev := public.inv_reverse_movement(v_line.stock_movement_id, trim(p_reason));
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

CREATE OR REPLACE FUNCTION public.pur_list_purchases(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r)::jsonb)
    FROM (
      SELECT
        p.id,
        p.reference,
        p.source_kind,
        p.supplier_id,
        s.name_ar AS supplier_name_ar,
        p.direct_label,
        p.payment_method,
        p.currency_code,
        p.treasury_id,
        t.name AS treasury_name,
        p.total_amount,
        p.notes,
        p.status,
        p.created_at,
        p.executed_at,
        p.reversed_at,
        p.reversal_reason,
        (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id,
            'ingredient_id', l.ingredient_id,
            'ingredient_name_ar', i.name_ar,
            'qty', l.qty,
            'uom_id', l.uom_id,
            'unit_price', l.unit_price,
            'line_total', l.line_total,
            'stock_movement_id', l.stock_movement_id
          ) ORDER BY l.created_at), '[]'::jsonb)
          FROM public.purchase_lines l
          JOIN public.ingredients i ON i.id = l.ingredient_id
          WHERE l.purchase_id = p.id
        ) AS lines
      FROM public.purchases p
      LEFT JOIN public.suppliers s ON s.id = p.supplier_id
      JOIN public.treasuries t ON t.id = p.treasury_id
      WHERE p.restaurant_id = v_rest
      ORDER BY p.created_at DESC
      LIMIT v_limit
    ) r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_get_purchase(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_row jsonb;
BEGIN
  SELECT row_to_json(r)::jsonb INTO v_row
  FROM (
    SELECT
      p.id,
      p.reference,
      p.source_kind,
      p.supplier_id,
      s.name_ar AS supplier_name_ar,
      p.direct_label,
      p.payment_method,
      p.currency_code,
      p.treasury_id,
      t.name AS treasury_name,
      p.total_amount,
      p.notes,
      p.status,
      p.created_at,
      p.executed_at,
      p.reversed_at,
      p.reversal_reason,
      (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', l.id,
          'ingredient_id', l.ingredient_id,
          'ingredient_name_ar', i.name_ar,
          'qty', l.qty,
          'uom_id', l.uom_id,
          'unit_price', l.unit_price,
          'line_total', l.line_total,
          'notes', l.notes,
          'stock_movement_id', l.stock_movement_id
        ) ORDER BY l.created_at), '[]'::jsonb)
        FROM public.purchase_lines l
        JOIN public.ingredients i ON i.id = l.ingredient_id
        WHERE l.purchase_id = p.id
      ) AS lines
    FROM public.purchases p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    JOIN public.treasuries t ON t.id = p.treasury_id
    WHERE p.id = p_id AND p.restaurant_id = v_rest
  ) r;

  IF v_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pur_list_suppliers(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_upsert_supplier(uuid, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_set_supplier_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_post_direct_cash_purchase(uuid, text, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_reverse_direct_cash_purchase(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_list_purchases(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_get_purchase(uuid) TO authenticated;
