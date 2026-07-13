-- INVA Inventory — locations, append-only movements, Stock Card, dashboard
-- Plan: docs/inventory-plan.md (Approved) · qty only (INV-20) · no counts/consumption yet

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
    'inventory.settings_upserted'
  )
);

DO $$ BEGIN
  CREATE TYPE public.stock_movement_type AS ENUM (
    'opening',
    'receive',
    'purchase_receive',
    'issue',
    'production_in',
    'production_out',
    'recipe_consumption',
    'waste',
    'count_variance',
    'adjustment',
    'transfer_out',
    'transfer_in',
    'reverse'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_movement_direction AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Locations (Q-INV6: one default in INVA)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name_ar text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_locations_code CHECK (length(trim(code)) > 0),
  CONSTRAINT chk_stock_locations_name CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT uq_stock_locations_code UNIQUE (restaurant_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_locations_one_default
  ON public.stock_locations (restaurant_id)
  WHERE is_default;

-- ---------------------------------------------------------------------------
-- Lots (Q-INV7: ready, not mandatory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients (id) ON DELETE RESTRICT,
  lot_code text NOT NULL,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stock_lots UNIQUE (restaurant_id, ingredient_id, lot_code)
);

-- ---------------------------------------------------------------------------
-- Settings / notification-ready signals (INV-19)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredient_stock_settings (
  ingredient_id uuid PRIMARY KEY REFERENCES public.ingredients (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reorder_level numeric(14, 4) NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL DEFAULT true,
  signal_low_stock boolean NOT NULL DEFAULT true,
  signal_no_movement boolean NOT NULL DEFAULT true,
  signal_high_waste boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reorder_level CHECK (reorder_level >= 0)
);

-- ---------------------------------------------------------------------------
-- Movements — append-only qty SSOT (INV-1, INV-17)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients (id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.stock_locations (id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES public.stock_lots (id) ON DELETE RESTRICT,
  movement_type public.stock_movement_type NOT NULL,
  direction public.stock_movement_direction NOT NULL,
  qty numeric(14, 4) NOT NULL,
  uom_id uuid NOT NULL REFERENCES public.uoms (id) ON DELETE RESTRICT,
  qty_base numeric(14, 4) NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT now(),
  reference text NOT NULL,
  source_type text,
  source_id uuid,
  reason text,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverses_movement_id uuid REFERENCES public.stock_movements (id) ON DELETE RESTRICT,
  CONSTRAINT chk_stock_movements_qty CHECK (qty > 0 AND qty_base > 0),
  CONSTRAINT chk_stock_movements_reference CHECK (length(trim(reference)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_card
  ON public.stock_movements (restaurant_id, ingredient_id, location_id, moved_at, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_type
  ON public.stock_movements (restaurant_id, movement_type, moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_source
  ON public.stock_movements (restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_idempotency
  ON public.stock_movements (restaurant_id, source_type, source_id, ingredient_id, movement_type)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    AND movement_type <> 'reverse';

-- Placeholder for INVB counts (empty table ok — dashboard can query)
CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.stock_locations (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  counted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_count_status CHECK (
    status IN ('draft', 'pending', 'approved', 'rejected', 'auto_closed')
  )
);

ALTER TABLE public.stock_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_stock_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_locations_select ON public.stock_locations FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());
CREATE POLICY stock_lots_select ON public.stock_lots FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());
CREATE POLICY ingredient_stock_settings_select ON public.ingredient_stock_settings FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());
CREATE POLICY stock_count_sessions_select ON public.stock_count_sessions FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_require_manager()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN public.m4_require_manager();
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_ensure_default_location(p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.stock_locations
  WHERE restaurant_id = p_restaurant_id AND is_default
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.stock_locations (restaurant_id, code, name_ar, is_default)
  VALUES (p_restaurant_id, 'main', 'المخزن الرئيسي', true)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_signed_qty_base(
  p_direction public.stock_movement_direction,
  p_qty_base numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_direction = 'in' THEN p_qty_base ELSE -p_qty_base END;
$$;

CREATE OR REPLACE FUNCTION public.inv_on_hand(
  p_restaurant_id uuid,
  p_ingredient_id uuid,
  p_location_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sum numeric;
BEGIN
  SELECT coalesce(sum(public.inv_signed_qty_base(m.direction, m.qty_base)), 0)
  INTO v_sum
  FROM public.stock_movements m
  WHERE m.restaurant_id = p_restaurant_id
    AND m.ingredient_id = p_ingredient_id
    AND (p_location_id IS NULL OR m.location_id = p_location_id);
  RETURN v_sum;
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_next_reference(p_restaurant_id uuid, p_prefix text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*)::int + 1 INTO v_n
  FROM public.stock_movements
  WHERE restaurant_id = p_restaurant_id
    AND created_at::date = (now() AT TIME ZONE 'Africa/Cairo')::date;
  RETURN p_prefix || '-' || to_char((now() AT TIME ZONE 'Africa/Cairo'), 'YYYYMMDD')
    || '-' || lpad(v_n::text, 4, '0');
END;
$$;

-- Direction defaults by type
CREATE OR REPLACE FUNCTION public.inv_default_direction(p_type public.stock_movement_type)
RETURNS public.stock_movement_direction
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'opening' THEN 'in'::public.stock_movement_direction
    WHEN 'receive' THEN 'in'::public.stock_movement_direction
    WHEN 'purchase_receive' THEN 'in'::public.stock_movement_direction
    WHEN 'production_in' THEN 'in'::public.stock_movement_direction
    WHEN 'transfer_in' THEN 'in'::public.stock_movement_direction
    WHEN 'issue' THEN 'out'::public.stock_movement_direction
    WHEN 'production_out' THEN 'out'::public.stock_movement_direction
    WHEN 'recipe_consumption' THEN 'out'::public.stock_movement_direction
    WHEN 'waste' THEN 'out'::public.stock_movement_direction
    WHEN 'transfer_out' THEN 'out'::public.stock_movement_direction
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- Post movement (INVA types only for public post)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_post_movement(
  p_ingredient_id uuid,
  p_movement_type public.stock_movement_type,
  p_qty numeric,
  p_uom_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL,
  p_direction public.stock_movement_direction DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_loc uuid;
  v_qty_base numeric;
  v_dir public.stock_movement_direction;
  v_ref text;
  v_id uuid;
  v_on_hand numeric;
  v_warn boolean := false;
  v_allowed text[] := ARRAY[
    'opening', 'receive', 'issue', 'waste', 'adjustment'
  ];
BEGIN
  IF NOT (p_movement_type::text = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'MOVEMENT_TYPE_NOT_IN_INVA';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients i
    WHERE i.id = p_ingredient_id AND i.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  v_loc := coalesce(p_location_id, public.inv_ensure_default_location(v_rest));
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_locations l
    WHERE l.id = v_loc AND l.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT public.rc_convert_qty(
    v_rest, p_qty, p_uom_id,
    (SELECT base_uom_id FROM public.ingredients WHERE id = p_ingredient_id)
  ) INTO v_qty_base;

  IF p_movement_type = 'adjustment' THEN
    IF p_direction IS NULL THEN
      RAISE EXCEPTION 'INVALID_DIRECTION';
    END IF;
    v_dir := p_direction;
  ELSE
    v_dir := public.inv_default_direction(p_movement_type);
  END IF;

  IF p_movement_type IN ('waste', 'adjustment') AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  v_ref := coalesce(nullif(trim(p_reference), ''), public.inv_next_reference(v_rest, upper(p_movement_type::text)));

  INSERT INTO public.stock_movements (
    restaurant_id, ingredient_id, location_id, lot_id,
    movement_type, direction, qty, uom_id, qty_base,
    reference, source_type, source_id, reason, created_by
  ) VALUES (
    v_rest, p_ingredient_id, v_loc, p_lot_id,
    p_movement_type, v_dir, p_qty, p_uom_id, v_qty_base,
    v_ref, p_source_type, p_source_id, nullif(trim(p_reason), ''), v_staff
  )
  RETURNING id INTO v_id;

  v_on_hand := public.inv_on_hand(v_rest, p_ingredient_id, v_loc);
  IF v_on_hand < 0 THEN
    v_warn := true;
  END IF;

  PERFORM public.log_audit_event(
    v_rest, 'inventory.movement_posted', NULL, v_staff,
    'stock_movement', v_id, NULL,
    jsonb_build_object(
      'type', p_movement_type, 'ingredient_id', p_ingredient_id,
      'qty_base', v_qty_base, 'direction', v_dir, 'reference', v_ref
    )
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'reference', v_ref,
    'on_hand_after', v_on_hand,
    'negative_stock_warning', v_warn
  );
END;
$$;

-- Reverse (INV-17, Q-INV8)
CREATE OR REPLACE FUNCTION public.inv_reverse_movement(
  p_movement_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_m public.stock_movements%ROWTYPE;
  v_dir public.stock_movement_direction;
  v_id uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_m
  FROM public.stock_movements
  WHERE id = p_movement_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements r
    WHERE r.reverses_movement_id = p_movement_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_REVERSED';
  END IF;
  IF v_m.movement_type = 'reverse' THEN
    RAISE EXCEPTION 'CANNOT_REVERSE_REVERSE';
  END IF;

  v_dir := CASE WHEN v_m.direction = 'in' THEN 'out'::public.stock_movement_direction
                ELSE 'in'::public.stock_movement_direction END;
  v_ref := public.inv_next_reference(v_rest, 'REV');

  INSERT INTO public.stock_movements (
    restaurant_id, ingredient_id, location_id, lot_id,
    movement_type, direction, qty, uom_id, qty_base,
    reference, source_type, source_id, reason, created_by, reverses_movement_id
  ) VALUES (
    v_rest, v_m.ingredient_id, v_m.location_id, v_m.lot_id,
    'reverse', v_dir, v_m.qty, v_m.uom_id, v_m.qty_base,
    v_ref, v_m.source_type, v_m.source_id,
    coalesce(nullif(trim(p_reason), ''), 'عكس حركة ' || v_m.reference),
    v_staff, v_m.id
  )
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    v_rest, 'inventory.movement_reversed', NULL, v_staff,
    'stock_movement', v_id, NULL,
    jsonb_build_object('reverses', p_movement_id, 'reference', v_ref)
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'reference', v_ref,
    'reverses_movement_id', p_movement_id,
    'on_hand_after', public.inv_on_hand(v_rest, v_m.ingredient_id, v_m.location_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_list_locations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
BEGIN
  PERFORM public.inv_ensure_default_location(v_rest);
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.is_default DESC, x.name_ar)
    FROM (
      SELECT id, code, name_ar, is_default, is_active
      FROM public.stock_locations WHERE restaurant_id = v_rest
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_list_stock_levels()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_loc uuid;
BEGIN
  v_loc := public.inv_ensure_default_location(v_rest);
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name_ar)
    FROM (
      SELECT
        i.id AS ingredient_id,
        i.name_ar,
        i.code,
        u.code AS base_uom_code,
        u.name_ar AS base_uom_name_ar,
        public.inv_on_hand(v_rest, i.id, v_loc) AS on_hand,
        coalesce(s.reorder_level, 0) AS reorder_level,
        (public.inv_on_hand(v_rest, i.id, v_loc) <= 0) AS is_out,
        (
          public.inv_on_hand(v_rest, i.id, v_loc) > 0
          AND public.inv_on_hand(v_rest, i.id, v_loc) <= coalesce(s.reorder_level, 0)
          AND coalesce(s.reorder_level, 0) > 0
        ) AS is_low,
        i.is_active
      FROM public.ingredients i
      JOIN public.uoms u ON u.id = i.base_uom_id
      LEFT JOIN public.ingredient_stock_settings s ON s.ingredient_id = i.id
      WHERE i.restaurant_id = v_rest AND i.is_active
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_upsert_stock_settings(
  p_ingredient_id uuid,
  p_reorder_level numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients i
    WHERE i.id = p_ingredient_id AND i.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  INSERT INTO public.ingredient_stock_settings (ingredient_id, restaurant_id, reorder_level)
  VALUES (p_ingredient_id, v_rest, coalesce(p_reorder_level, 0))
  ON CONFLICT (ingredient_id) DO UPDATE SET
    reorder_level = excluded.reorder_level,
    updated_at = now();
  PERFORM public.log_audit_event(
    v_rest, 'inventory.settings_upserted', NULL, public.auth_staff_id(),
    'ingredient', p_ingredient_id, NULL,
    jsonb_build_object('reorder_level', coalesce(p_reorder_level, 0))
  );
  RETURN jsonb_build_object('ingredient_id', p_ingredient_id, 'reorder_level', coalesce(p_reorder_level, 0));
END;
$$;

-- Stock Card (INV-15)
CREATE OR REPLACE FUNCTION public.inv_get_stock_card(
  p_ingredient_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_loc uuid;
  v_rows jsonb;
  v_on_hand numeric;
  v_name text;
  v_uom text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ingredients i
    WHERE i.id = p_ingredient_id AND i.restaurant_id = v_rest
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  v_loc := coalesce(p_location_id, public.inv_ensure_default_location(v_rest));

  SELECT i.name_ar, u.name_ar INTO v_name, v_uom
  FROM public.ingredients i
  JOIN public.uoms u ON u.id = i.base_uom_id
  WHERE i.id = p_ingredient_id;

  v_on_hand := public.inv_on_hand(v_rest, p_ingredient_id, v_loc);

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.moved_at, x.created_at, x.id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      m.id,
      m.moved_at,
      m.created_at,
      m.movement_type::text AS movement_type,
      m.direction::text AS direction,
      m.reference,
      m.qty,
      m.qty_base,
      uu.code AS uom_code,
      uu.name_ar AS uom_name_ar,
      CASE WHEN m.direction = 'in' THEN m.qty_base ELSE 0 END AS qty_in,
      CASE WHEN m.direction = 'out' THEN m.qty_base ELSE 0 END AS qty_out,
      m.reason,
      m.source_type,
      m.source_id,
      m.reverses_movement_id,
      m.created_by,
      st.display_name AS created_by_name,
      sum(public.inv_signed_qty_base(m.direction, m.qty_base)) OVER (
        ORDER BY m.moved_at, m.created_at, m.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS balance_after
    FROM public.stock_movements m
    JOIN public.uoms uu ON uu.id = m.uom_id
    LEFT JOIN public.staff st ON st.id = m.created_by
    WHERE m.restaurant_id = v_rest
      AND m.ingredient_id = p_ingredient_id
      AND m.location_id = v_loc
    ORDER BY m.moved_at, m.created_at, m.id
    LIMIT LEAST(coalesce(p_limit, 200), 500)
  ) x;

  RETURN jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'ingredient_name_ar', v_name,
    'base_uom_name_ar', v_uom,
    'location_id', v_loc,
    'on_hand', v_on_hand,
    'negative_stock_warning', v_on_hand < 0,
    'rows', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inv_get_movement(p_movement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_row jsonb;
BEGIN
  SELECT row_to_json(x)::jsonb INTO v_row
  FROM (
    SELECT
      m.*,
      m.movement_type::text AS movement_type,
      m.direction::text AS direction,
      i.name_ar AS ingredient_name_ar,
      st.display_name AS created_by_name,
      l.name_ar AS location_name_ar
    FROM public.stock_movements m
    JOIN public.ingredients i ON i.id = m.ingredient_id
    JOIN public.stock_locations l ON l.id = m.location_id
    LEFT JOIN public.staff st ON st.id = m.created_by
    WHERE m.id = p_movement_id AND m.restaurant_id = v_rest
  ) x;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  RETURN v_row;
END;
$$;

-- Dashboard (INV-8, INV-18)
CREATE OR REPLACE FUNCTION public.inv_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.inv_require_manager();
  v_loc uuid;
  v_levels jsonb;
  v_total int := 0;
  v_low int := 0;
  v_out int := 0;
  v_no_move int := 0;
  v_since timestamptz := now() - interval '14 days';
BEGIN
  v_loc := public.inv_ensure_default_location(v_rest);
  v_levels := public.inv_list_stock_levels();

  SELECT count(*) INTO v_total FROM jsonb_array_elements(v_levels);
  SELECT count(*) INTO v_low FROM jsonb_array_elements(v_levels) e WHERE (e.value->>'is_low')::boolean;
  SELECT count(*) INTO v_out FROM jsonb_array_elements(v_levels) e WHERE (e.value->>'is_out')::boolean;

  SELECT count(*) INTO v_no_move
  FROM public.ingredients i
  WHERE i.restaurant_id = v_rest AND i.is_active
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_movements m
      WHERE m.ingredient_id = i.id AND m.moved_at >= v_since
    );

  RETURN jsonb_build_object(
    'location_id', v_loc,
    'ingredients_total', v_total,
    'low_stock_count', v_low,
    'out_of_stock_count', v_out,
    'no_movement_14d_count', v_no_move,
    'variance_ingredients_count', 0,
    'near_expiry_count', NULL,
    'near_expiry_enabled', false,
    'top_consumed', coalesce((
      SELECT jsonb_agg(row_to_json(x)::jsonb)
      FROM (
        SELECT i.name_ar, sum(m.qty_base) AS qty_base
        FROM public.stock_movements m
        JOIN public.ingredients i ON i.id = m.ingredient_id
        WHERE m.restaurant_id = v_rest
          AND m.direction = 'out'
          AND m.movement_type IN ('recipe_consumption', 'issue')
          AND m.moved_at >= v_since
        GROUP BY i.id, i.name_ar
        ORDER BY sum(m.qty_base) DESC
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    'top_waste', coalesce((
      SELECT jsonb_agg(row_to_json(x)::jsonb)
      FROM (
        SELECT i.name_ar, sum(m.qty_base) AS qty_base
        FROM public.stock_movements m
        JOIN public.ingredients i ON i.id = m.ingredient_id
        WHERE m.restaurant_id = v_rest
          AND m.movement_type = 'waste'
          AND m.moved_at >= v_since
        GROUP BY i.id, i.name_ar
        ORDER BY sum(m.qty_base) DESC
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    'recent_movements', coalesce((
      SELECT jsonb_agg(row_to_json(x)::jsonb)
      FROM (
        SELECT
          m.id, m.moved_at, m.movement_type::text AS movement_type,
          m.reference, i.name_ar AS ingredient_name_ar,
          m.direction::text AS direction, m.qty_base,
          st.display_name AS created_by_name
        FROM public.stock_movements m
        JOIN public.ingredients i ON i.id = m.ingredient_id
        LEFT JOIN public.staff st ON st.id = m.created_by
        WHERE m.restaurant_id = v_rest
        ORDER BY m.moved_at DESC, m.created_at DESC
        LIMIT 10
      ) x
    ), '[]'::jsonb),
    'recent_counts', coalesce((
      SELECT jsonb_agg(row_to_json(x)::jsonb)
      FROM (
        SELECT id, status, counted_at, created_at
        FROM public.stock_count_sessions
        WHERE restaurant_id = v_rest
        ORDER BY created_at DESC
        LIMIT 5
      ) x
    ), '[]'::jsonb),
    'signals', jsonb_build_object(
      'low_stock', v_low > 0,
      'out_of_stock', v_out > 0,
      'no_movement', v_no_move > 0,
      'high_waste', EXISTS (
        SELECT 1 FROM public.stock_movements m
        WHERE m.restaurant_id = v_rest AND m.movement_type = 'waste' AND m.moved_at >= v_since
      )
    )
  );
END;
$$;

-- Bootstrap default location for seed restaurant
SELECT public.inv_ensure_default_location('a0000000-0000-4000-8000-000000000001');

GRANT EXECUTE ON FUNCTION public.inv_require_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_ensure_default_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_on_hand(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_post_movement(
  uuid, public.stock_movement_type, numeric, uuid, uuid, text, uuid, text, uuid,
  public.stock_movement_direction, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_reverse_movement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_list_locations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_list_stock_levels() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_upsert_stock_settings(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_get_stock_card(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_get_movement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inv_dashboard() TO authenticated;

NOTIFY pgrst, 'reload schema';
