-- RCA Recipes & Costing — schema + RPCs
-- Plan: docs/recipes-costing-plan.md (Approved) · Vision ADR-0033
-- RC-16: cost engine only — no inventory / purchasing / AI / promo

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
    'recipes.recipe_upserted', 'recipes.recipe_status_changed'
  )
);

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ingredient_cost_mode AS ENUM (
    'standard',
    'last_purchase',
    'moving_average'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- UoM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_uoms_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_uoms_name_ar CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT uq_uoms_restaurant_code UNIQUE (restaurant_id, code)
);

CREATE TABLE IF NOT EXISTS public.uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  from_uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  to_uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  factor numeric(18, 8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_uom_conversions_factor CHECK (factor > 0),
  CONSTRAINT chk_uom_conversions_distinct CHECK (from_uom_id IS DISTINCT FROM to_uom_id),
  CONSTRAINT uq_uom_conversions UNIQUE (restaurant_id, from_uom_id, to_uom_id)
);

-- ---------------------------------------------------------------------------
-- Ingredients (RC-11: no supplier_id · RC-12 fields)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name_ar text NOT NULL,
  name_en text,
  code text,
  base_uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  cost_mode public.ingredient_cost_mode NOT NULL DEFAULT 'standard',
  standard_cost numeric(14, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ingredients_name_ar CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT chk_ingredients_standard_cost CHECK (standard_cost >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ingredients_restaurant_code
  ON public.ingredients (restaurant_id, code)
  WHERE code IS NOT NULL AND length(trim(code)) > 0;

CREATE INDEX IF NOT EXISTS idx_ingredients_restaurant_active
  ON public.ingredients (restaurant_id, is_active, name_ar);

-- Append-only cost change log (Q-RC7)
CREATE TABLE IF NOT EXISTS public.ingredient_cost_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients (id) ON DELETE RESTRICT,
  cost_mode public.ingredient_cost_mode NOT NULL,
  old_standard_cost numeric(14, 4),
  new_standard_cost numeric(14, 4) NOT NULL,
  changed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE INDEX IF NOT EXISTS idx_ingredient_cost_changes_ingredient
  ON public.ingredient_cost_changes (ingredient_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Recipes (RC-13: IDs only for links)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  menu_item_id uuid REFERENCES public.menu_items (id) ON DELETE RESTRICT,
  name_ar text NOT NULL,
  name_en text,
  yield_qty numeric(14, 4) NOT NULL,
  yield_uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  waste_pct numeric(8, 4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_recipes_name_ar CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT chk_recipes_yield_qty CHECK (yield_qty > 0),
  CONSTRAINT chk_recipes_waste_pct CHECK (waste_pct >= 0 AND waste_pct < 100)
);

-- One active menu-linked recipe per item (RCA)
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipes_menu_item
  ON public.recipes (restaurant_id, menu_item_id)
  WHERE menu_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recipes_restaurant
  ON public.recipes (restaurant_id, is_active);

CREATE TABLE IF NOT EXISTS public.recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients (id) ON DELETE RESTRICT,
  qty numeric(14, 4) NOT NULL,
  uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  sort_order int NOT NULL DEFAULT 0,
  CONSTRAINT chk_recipe_lines_qty CHECK (qty > 0),
  CONSTRAINT uq_recipe_lines_ingredient UNIQUE (recipe_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_lines_recipe
  ON public.recipe_lines (recipe_id, sort_order);

-- ---------------------------------------------------------------------------
-- RLS (manager write via RPC; authenticated read blocked — use RPCs)
-- ---------------------------------------------------------------------------
ALTER TABLE public.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_cost_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uoms_select ON public.uoms;
CREATE POLICY uoms_select ON public.uoms FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

DROP POLICY IF EXISTS uom_conversions_select ON public.uom_conversions;
CREATE POLICY uom_conversions_select ON public.uom_conversions FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

DROP POLICY IF EXISTS ingredients_select ON public.ingredients;
CREATE POLICY ingredients_select ON public.ingredients FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

DROP POLICY IF EXISTS ingredient_cost_changes_select ON public.ingredient_cost_changes;
CREATE POLICY ingredient_cost_changes_select ON public.ingredient_cost_changes FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

DROP POLICY IF EXISTS recipes_select ON public.recipes;
CREATE POLICY recipes_select ON public.recipes FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

DROP POLICY IF EXISTS recipe_lines_select ON public.recipe_lines;
CREATE POLICY recipe_lines_select ON public.recipe_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.id = recipe_id
        AND r.restaurant_id = public.auth_restaurant_id()
        AND public.is_owner_or_manager()
    )
  );

-- ---------------------------------------------------------------------------
-- Auth helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rc_require_manager()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.m4_require_manager();
END;
$$;

-- ---------------------------------------------------------------------------
-- UoM conversion helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rc_convert_qty(
  p_restaurant_id uuid,
  p_qty numeric,
  p_from_uom uuid,
  p_to_uom uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor numeric;
BEGIN
  IF p_qty IS NULL OR p_from_uom IS NULL OR p_to_uom IS NULL THEN
    RAISE EXCEPTION 'INVALID_UOM_CONVERSION';
  END IF;
  IF p_from_uom = p_to_uom THEN
    RETURN p_qty;
  END IF;

  SELECT c.factor INTO v_factor
  FROM public.uom_conversions c
  WHERE c.restaurant_id = p_restaurant_id
    AND c.from_uom_id = p_from_uom
    AND c.to_uom_id = p_to_uom
  LIMIT 1;

  IF v_factor IS NOT NULL THEN
    RETURN p_qty * v_factor;
  END IF;

  SELECT c.factor INTO v_factor
  FROM public.uom_conversions c
  WHERE c.restaurant_id = p_restaurant_id
    AND c.from_uom_id = p_to_uom
    AND c.to_uom_id = p_from_uom
  LIMIT 1;

  IF v_factor IS NOT NULL AND v_factor <> 0 THEN
    RETURN p_qty / v_factor;
  END IF;

  RAISE EXCEPTION 'MISSING_UOM_CONVERSION';
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed default UoMs for restaurant (idempotent by code)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rc_ensure_default_uoms(p_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g uuid; v_kg uuid; v_ml uuid; v_l uuid; v_pc uuid; v_portion uuid;
BEGIN
  INSERT INTO public.uoms (restaurant_id, code, name_ar, name_en)
  VALUES
    (p_restaurant_id, 'g', 'جرام', 'Gram'),
    (p_restaurant_id, 'kg', 'كيلوجرام', 'Kilogram'),
    (p_restaurant_id, 'ml', 'ملليلتر', 'Millilitre'),
    (p_restaurant_id, 'l', 'لتر', 'Litre'),
    (p_restaurant_id, 'pc', 'قطعة', 'Piece'),
    (p_restaurant_id, 'portion', 'حصة', 'Portion')
  ON CONFLICT (restaurant_id, code) DO NOTHING;

  SELECT id INTO v_g FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'g';
  SELECT id INTO v_kg FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'kg';
  SELECT id INTO v_ml FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'ml';
  SELECT id INTO v_l FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'l';
  SELECT id INTO v_pc FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'pc';
  SELECT id INTO v_portion FROM public.uoms WHERE restaurant_id = p_restaurant_id AND code = 'portion';

  INSERT INTO public.uom_conversions (restaurant_id, from_uom_id, to_uom_id, factor)
  VALUES
    (p_restaurant_id, v_kg, v_g, 1000),
    (p_restaurant_id, v_l, v_ml, 1000)
  ON CONFLICT (restaurant_id, from_uom_id, to_uom_id) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- list / upsert UoMs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_uoms()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  PERFORM public.rc_ensure_default_uoms(v_rest);
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.code)
    FROM (
      SELECT id, code, name_ar, name_en, is_active
      FROM public.uoms
      WHERE restaurant_id = v_rest
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_uom_conversions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.from_code, x.to_code)
    FROM (
      SELECT
        c.id,
        c.from_uom_id,
        c.to_uom_id,
        c.factor,
        f.code AS from_code,
        t.code AS to_code,
        f.name_ar AS from_name_ar,
        t.name_ar AS to_name_ar
      FROM public.uom_conversions c
      JOIN public.uoms f ON f.id = c.from_uom_id
      JOIN public.uoms t ON t.id = c.to_uom_id
      WHERE c.restaurant_id = v_rest
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_uom_conversion(
  p_from_uom_id uuid,
  p_to_uom_id uuid,
  p_factor numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_id uuid;
BEGIN
  IF p_factor IS NULL OR p_factor <= 0 THEN
    RAISE EXCEPTION 'INVALID_FACTOR';
  END IF;
  IF p_from_uom_id = p_to_uom_id THEN
    RAISE EXCEPTION 'INVALID_UOM_CONVERSION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.uoms u
    WHERE u.id IN (p_from_uom_id, p_to_uom_id) AND u.restaurant_id = v_rest
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  INSERT INTO public.uom_conversions (restaurant_id, from_uom_id, to_uom_id, factor)
  VALUES (v_rest, p_from_uom_id, p_to_uom_id, p_factor)
  ON CONFLICT (restaurant_id, from_uom_id, to_uom_id)
  DO UPDATE SET factor = excluded.factor
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    v_rest, 'recipes.uom_conversion_upserted', NULL, public.auth_staff_id(),
    'uom_conversion', v_id, NULL,
    jsonb_build_object('from', p_from_uom_id, 'to', p_to_uom_id, 'factor', p_factor)
  );

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Ingredients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_ingredients(p_active_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  PERFORM public.rc_ensure_default_uoms(v_rest);
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name_ar)
    FROM (
      SELECT
        i.id,
        i.name_ar,
        i.name_en,
        i.code,
        i.base_uom_id,
        u.code AS base_uom_code,
        u.name_ar AS base_uom_name_ar,
        i.is_active,
        i.cost_mode::text AS cost_mode,
        i.standard_cost,
        i.updated_at
      FROM public.ingredients i
      JOIN public.uoms u ON u.id = i.base_uom_id
      WHERE i.restaurant_id = v_rest
        AND (NOT p_active_only OR i.is_active)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_ingredient(
  p_id uuid,
  p_name_ar text,
  p_name_en text,
  p_code text,
  p_base_uom_id uuid,
  p_standard_cost numeric,
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_id uuid;
  v_old numeric;
  v_staff uuid := public.auth_staff_id();
BEGIN
  IF p_name_ar IS NULL OR length(trim(p_name_ar)) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF coalesce(p_standard_cost, -1) < 0 THEN
    RAISE EXCEPTION 'INVALID_COST';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.uoms u WHERE u.id = p_base_uom_id AND u.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.ingredients (
      restaurant_id, name_ar, name_en, code, base_uom_id,
      cost_mode, standard_cost, is_active
    ) VALUES (
      v_rest, trim(p_name_ar), nullif(trim(p_name_en), ''), nullif(trim(p_code), ''),
      p_base_uom_id, 'standard', coalesce(p_standard_cost, 0), coalesce(p_is_active, true)
    )
    RETURNING id INTO v_id;

    INSERT INTO public.ingredient_cost_changes (
      restaurant_id, ingredient_id, cost_mode, old_standard_cost, new_standard_cost, changed_by, note
    ) VALUES (
      v_rest, v_id, 'standard', NULL, coalesce(p_standard_cost, 0), v_staff, 'initial'
    );
  ELSE
    SELECT standard_cost INTO v_old
    FROM public.ingredients
    WHERE id = p_id AND restaurant_id = v_rest
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    UPDATE public.ingredients SET
      name_ar = trim(p_name_ar),
      name_en = nullif(trim(p_name_en), ''),
      code = nullif(trim(p_code), ''),
      base_uom_id = p_base_uom_id,
      standard_cost = coalesce(p_standard_cost, 0),
      is_active = coalesce(p_is_active, true),
      cost_mode = 'standard',
      updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    IF v_old IS DISTINCT FROM coalesce(p_standard_cost, 0) THEN
      INSERT INTO public.ingredient_cost_changes (
        restaurant_id, ingredient_id, cost_mode, old_standard_cost, new_standard_cost, changed_by
      ) VALUES (
        v_rest, v_id, 'standard', v_old, coalesce(p_standard_cost, 0), v_staff
      );
      PERFORM public.log_audit_event(
        v_rest, 'recipes.ingredient_cost_changed', NULL, v_staff,
        'ingredient', v_id, jsonb_build_object('standard_cost', v_old),
        jsonb_build_object('standard_cost', coalesce(p_standard_cost, 0), 'cost_mode', 'standard')
      );
    END IF;
  END IF;

  PERFORM public.log_audit_event(
    v_rest, 'recipes.ingredient_upserted', NULL, v_staff,
    'ingredient', v_id, NULL,
    jsonb_build_object('name_ar', trim(p_name_ar), 'standard_cost', coalesce(p_standard_cost, 0))
  );

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Recipes CRUD
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_recipes(p_active_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name_ar)
    FROM (
      SELECT
        r.id,
        r.menu_item_id,
        mi.name AS menu_item_name,
        r.name_ar,
        r.name_en,
        r.yield_qty,
        r.yield_uom_id,
        yu.code AS yield_uom_code,
        yu.name_ar AS yield_uom_name_ar,
        r.waste_pct,
        r.is_active,
        (r.menu_item_id IS NULL) AS is_prep,
        (
          SELECT count(*)::int FROM public.recipe_lines rl WHERE rl.recipe_id = r.id
        ) AS line_count
      FROM public.recipes r
      LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
      JOIN public.uoms yu ON yu.id = r.yield_uom_id
      WHERE r.restaurant_id = v_rest
        AND (NOT p_active_only OR r.is_active)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_recipe(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_head jsonb;
  v_lines jsonb;
BEGIN
  SELECT row_to_json(x)::jsonb INTO v_head
  FROM (
    SELECT
      r.id,
      r.menu_item_id,
      mi.name AS menu_item_name,
      mi.base_price AS menu_sell_price,
      r.name_ar,
      r.name_en,
      r.yield_qty,
      r.yield_uom_id,
      yu.code AS yield_uom_code,
      yu.name_ar AS yield_uom_name_ar,
      r.waste_pct,
      r.is_active,
      (r.menu_item_id IS NULL) AS is_prep
    FROM public.recipes r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
    JOIN public.uoms yu ON yu.id = r.yield_uom_id
    WHERE r.id = p_recipe_id AND r.restaurant_id = v_rest
  ) x;

  IF v_head IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_order, x.ingredient_name_ar), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT
      rl.id,
      rl.ingredient_id,
      i.name_ar AS ingredient_name_ar,
      i.cost_mode::text AS cost_mode,
      i.standard_cost,
      i.base_uom_id,
      bu.code AS base_uom_code,
      rl.qty,
      rl.uom_id,
      uu.code AS uom_code,
      uu.name_ar AS uom_name_ar,
      rl.sort_order
    FROM public.recipe_lines rl
    JOIN public.ingredients i ON i.id = rl.ingredient_id
    JOIN public.uoms bu ON bu.id = i.base_uom_id
    JOIN public.uoms uu ON uu.id = rl.uom_id
    WHERE rl.recipe_id = p_recipe_id
  ) x;

  RETURN v_head || jsonb_build_object('lines', v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_recipe(
  p_id uuid,
  p_menu_item_id uuid,
  p_name_ar text,
  p_name_en text,
  p_yield_qty numeric,
  p_yield_uom_id uuid,
  p_waste_pct numeric,
  p_is_active boolean,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_id uuid;
  v_staff uuid := public.auth_staff_id();
  v_line jsonb;
  v_sort int := 0;
BEGIN
  IF p_name_ar IS NULL OR length(trim(p_name_ar)) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_yield_qty IS NULL OR p_yield_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_YIELD';
  END IF;
  IF coalesce(p_waste_pct, 0) < 0 OR coalesce(p_waste_pct, 0) >= 100 THEN
    RAISE EXCEPTION 'INVALID_WASTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.uoms u WHERE u.id = p_yield_uom_id AND u.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF p_menu_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.id = p_menu_item_id AND mi.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.recipes (
      restaurant_id, menu_item_id, name_ar, name_en,
      yield_qty, yield_uom_id, waste_pct, is_active
    ) VALUES (
      v_rest, p_menu_item_id, trim(p_name_ar), nullif(trim(p_name_en), ''),
      p_yield_qty, p_yield_uom_id, coalesce(p_waste_pct, 0), coalesce(p_is_active, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.recipes SET
      menu_item_id = p_menu_item_id,
      name_ar = trim(p_name_ar),
      name_en = nullif(trim(p_name_en), ''),
      yield_qty = p_yield_qty,
      yield_uom_id = p_yield_uom_id,
      waste_pct = coalesce(p_waste_pct, 0),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    DELETE FROM public.recipe_lines WHERE recipe_id = v_id;
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'EMPTY_RECIPE_LINES';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort := v_sort + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.ingredients i
      WHERE i.id = (v_line->>'ingredient_id')::uuid AND i.restaurant_id = v_rest
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.uoms u
      WHERE u.id = (v_line->>'uom_id')::uuid AND u.restaurant_id = v_rest
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF coalesce((v_line->>'qty')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY';
    END IF;

    INSERT INTO public.recipe_lines (recipe_id, ingredient_id, qty, uom_id, sort_order)
    VALUES (
      v_id,
      (v_line->>'ingredient_id')::uuid,
      (v_line->>'qty')::numeric,
      (v_line->>'uom_id')::uuid,
      coalesce((v_line->>'sort_order')::int, v_sort)
    );
  END LOOP;

  PERFORM public.log_audit_event(
    v_rest, 'recipes.recipe_upserted', NULL, v_staff,
    'recipe', v_id, NULL,
    jsonb_build_object(
      'menu_item_id', p_menu_item_id,
      'name_ar', trim(p_name_ar),
      'line_count', jsonb_array_length(p_lines)
    )
  );

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Cost breakdown (RC-15)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_recipe_cost(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_recipe public.recipes%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_qty_base numeric;
  v_line_cost numeric;
  v_ingredients_cost numeric := 0;
  v_total_batch numeric;
  v_unit_cost numeric;
  v_sell numeric;
  v_margin numeric;
  v_margin_pct numeric;
  v_menu_name text;
BEGIN
  SELECT * INTO v_recipe
  FROM public.recipes r
  WHERE r.id = p_recipe_id AND r.restaurant_id = v_rest;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  FOR v_line IN
    SELECT
      rl.ingredient_id,
      i.name_ar AS ingredient_name_ar,
      i.cost_mode::text AS cost_mode,
      i.standard_cost,
      i.base_uom_id,
      bu.code AS base_uom_code,
      bu.name_ar AS base_uom_name_ar,
      rl.qty,
      rl.uom_id,
      uu.code AS uom_code,
      uu.name_ar AS uom_name_ar
    FROM public.recipe_lines rl
    JOIN public.ingredients i ON i.id = rl.ingredient_id
    JOIN public.uoms bu ON bu.id = i.base_uom_id
    JOIN public.uoms uu ON uu.id = rl.uom_id
    WHERE rl.recipe_id = p_recipe_id
    ORDER BY rl.sort_order, i.name_ar
  LOOP
    v_qty_base := public.rc_convert_qty(v_rest, v_line.qty, v_line.uom_id, v_line.base_uom_id);
    v_line_cost := round(v_qty_base * v_line.standard_cost, 4);
    v_ingredients_cost := v_ingredients_cost + v_line_cost;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_line.ingredient_id,
      'ingredient_name_ar', v_line.ingredient_name_ar,
      'cost_mode', v_line.cost_mode,
      'qty', v_line.qty,
      'uom_id', v_line.uom_id,
      'uom_code', v_line.uom_code,
      'uom_name_ar', v_line.uom_name_ar,
      'qty_in_base', v_qty_base,
      'base_uom_code', v_line.base_uom_code,
      'unit_cost', v_line.standard_cost,
      'line_cost', v_line_cost
    ));
  END LOOP;

  v_total_batch := round(v_ingredients_cost * (1 + (v_recipe.waste_pct / 100.0)), 4);
  v_unit_cost := round(v_total_batch / v_recipe.yield_qty, 4);

  IF v_recipe.menu_item_id IS NOT NULL THEN
    SELECT mi.base_price, mi.name INTO v_sell, v_menu_name
    FROM public.menu_items mi
    WHERE mi.id = v_recipe.menu_item_id;
    IF v_sell IS NOT NULL AND v_sell > 0 THEN
      v_margin := round(v_sell - v_unit_cost, 4);
      v_margin_pct := round((v_margin / v_sell) * 100.0, 2);
    ELSE
      v_margin := NULL;
      v_margin_pct := NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'recipe_id', v_recipe.id,
    'menu_item_id', v_recipe.menu_item_id,
    'menu_item_name', v_menu_name,
    'recipe_name_ar', v_recipe.name_ar,
    'is_prep', v_recipe.menu_item_id IS NULL,
    'cost_mode_note', 'standard',
    'lines', v_lines,
    'ingredients_cost', round(v_ingredients_cost, 4),
    'waste_pct', v_recipe.waste_pct,
    'waste_cost', round(v_total_batch - v_ingredients_cost, 4),
    'total_batch_cost', v_total_batch,
    'yield_qty', v_recipe.yield_qty,
    'yield_uom_id', v_recipe.yield_uom_id,
    'cost_per_yield_unit', v_unit_cost,
    'sell_price', v_sell,
    'margin_amount', v_margin,
    'margin_pct', v_margin_pct
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_menu_item_cost(p_menu_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_recipe_id uuid;
  v_name text;
  v_price numeric;
BEGIN
  SELECT mi.name, mi.base_price INTO v_name, v_price
  FROM public.menu_items mi
  WHERE mi.id = p_menu_item_id AND mi.restaurant_id = v_rest;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.restaurant_id = v_rest
    AND r.menu_item_id = p_menu_item_id
    AND r.is_active
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RETURN jsonb_build_object(
      'menu_item_id', p_menu_item_id,
      'menu_item_name', v_name,
      'sell_price', v_price,
      'has_recipe', false,
      'message', 'NO_RECIPE'
    );
  END IF;

  RETURN public.compute_recipe_cost(v_recipe_id) || jsonb_build_object('has_recipe', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Coverage dashboard (RC-14)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recipes_coverage_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
  v_total int := 0;
  v_with int := 0;
  v_without int := 0;
  v_prep int := 0;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.menu_items mi
  WHERE mi.restaurant_id = v_rest AND mi.is_active;

  SELECT count(*) INTO v_with
  FROM public.menu_items mi
  WHERE mi.restaurant_id = v_rest
    AND mi.is_active
    AND EXISTS (
      SELECT 1 FROM public.recipes r
      WHERE r.menu_item_id = mi.id AND r.restaurant_id = v_rest AND r.is_active
    );

  v_without := v_total - v_with;

  SELECT count(*) INTO v_prep
  FROM public.recipes r
  WHERE r.restaurant_id = v_rest AND r.is_active AND r.menu_item_id IS NULL;

  RETURN jsonb_build_object(
    'menu_items_total', v_total,
    'with_recipe', v_with,
    'without_recipe', v_without,
    'coverage_pct',
      CASE WHEN v_total = 0 THEN NULL
      ELSE round((v_with::numeric / v_total::numeric) * 100, 1) END,
    'prep_recipes_count', v_prep
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_menu_items_recipe_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.has_recipe DESC, x.name)
    FROM (
      SELECT
        mi.id AS menu_item_id,
        mi.name,
        mi.base_price,
        mi.is_active,
        r.id AS recipe_id,
        (r.id IS NOT NULL) AS has_recipe
      FROM public.menu_items mi
      LEFT JOIN public.recipes r
        ON r.menu_item_id = mi.id AND r.restaurant_id = v_rest AND r.is_active
      WHERE mi.restaurant_id = v_rest
        AND mi.is_active
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_cost_impact(p_ingredient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients i
    WHERE i.id = p_ingredient_id AND i.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.recipe_name_ar)
    FROM (
      SELECT DISTINCT
        r.id AS recipe_id,
        r.name_ar AS recipe_name_ar,
        r.menu_item_id,
        mi.name AS menu_item_name
      FROM public.recipe_lines rl
      JOIN public.recipes r ON r.id = rl.recipe_id
      LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
      WHERE rl.ingredient_id = p_ingredient_id
        AND r.restaurant_id = v_rest
    ) x
  ), '[]'::jsonb);
END;
$$;

-- Seed defaults for known restaurant
SELECT public.rc_ensure_default_uoms('a0000000-0000-4000-8000-000000000001');

GRANT EXECUTE ON FUNCTION public.rc_require_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rc_convert_qty(uuid, numeric, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rc_ensure_default_uoms(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_uoms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_uom_conversions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_uom_conversion(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ingredients(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_ingredient(uuid, text, text, text, uuid, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recipes(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recipe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_recipe(uuid, uuid, text, text, numeric, uuid, numeric, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_recipe_cost(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_menu_item_cost(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recipes_coverage_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_menu_items_recipe_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_cost_impact(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
