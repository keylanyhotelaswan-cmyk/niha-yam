-- M3: Menu & Products schema (operations-first, single-restaurant, no tax).
-- Tables: menu_categories, menu_items, modifier_groups, modifier_options,
-- menu_item_modifier_groups. All writes go through SECURITY DEFINER RPCs;
-- RLS exposes SELECT to same-restaurant staff only.

-- Categories --------------------------------------------------------------
CREATE TABLE public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  show_in_pos boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_menu_categories_name CHECK (length(trim(name)) > 0)
);

CREATE INDEX idx_menu_categories_restaurant
  ON public.menu_categories (restaurant_id, sort_order);

-- Items -------------------------------------------------------------------
CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  category_id uuid REFERENCES public.menu_categories (id) ON DELETE RESTRICT,
  name text NOT NULL,
  sku text,
  base_price numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  show_in_pos boolean NOT NULL DEFAULT true,
  needs_kitchen boolean NOT NULL DEFAULT true,
  needs_print boolean NOT NULL DEFAULT true,
  accepts_modifiers boolean NOT NULL DEFAULT false,
  allows_discounts boolean NOT NULL DEFAULT true,
  is_open_price boolean NOT NULL DEFAULT false,
  is_favorite boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_menu_items_name CHECK (length(trim(name)) > 0),
  CONSTRAINT chk_menu_items_price CHECK (base_price >= 0),
  -- S6: an item visible in POS must belong to a category.
  CONSTRAINT chk_menu_items_pos_category CHECK (show_in_pos = false OR category_id IS NOT NULL)
);

CREATE INDEX idx_menu_items_restaurant
  ON public.menu_items (restaurant_id, sort_order);
CREATE INDEX idx_menu_items_category
  ON public.menu_items (category_id);

-- S5: SKU unique per restaurant when present (NULLs never collide).
CREATE UNIQUE INDEX uq_menu_items_sku
  ON public.menu_items (restaurant_id, lower(sku))
  WHERE sku IS NOT NULL;

-- Modifier groups ---------------------------------------------------------
CREATE TABLE public.modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  min_selections int NOT NULL DEFAULT 0,
  max_selections int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_modifier_groups_name CHECK (length(trim(name)) > 0),
  CONSTRAINT chk_modifier_groups_min CHECK (min_selections >= 0),
  -- max = 0 means unlimited (M3-Q6); otherwise max must be >= min.
  CONSTRAINT chk_modifier_groups_max CHECK (max_selections = 0 OR max_selections >= min_selections)
);

CREATE INDEX idx_modifier_groups_restaurant
  ON public.modifier_groups (restaurant_id, sort_order);

-- Modifier options --------------------------------------------------------
CREATE TABLE public.modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.modifier_groups (id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_modifier_options_name CHECK (length(trim(name)) > 0)
);

CREATE INDEX idx_modifier_options_group
  ON public.modifier_options (group_id, sort_order);

-- Item ↔ group links ------------------------------------------------------
CREATE TABLE public.menu_item_modifier_groups (
  menu_item_id uuid NOT NULL REFERENCES public.menu_items (id) ON DELETE CASCADE,
  modifier_group_id uuid NOT NULL REFERENCES public.modifier_groups (id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, modifier_group_id)
);

CREATE INDEX idx_menu_item_modifier_groups_group
  ON public.menu_item_modifier_groups (modifier_group_id);

-- updated_at triggers -----------------------------------------------------
CREATE TRIGGER trg_menu_categories_updated_at
  BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_modifier_groups_updated_at
  BEFORE UPDATE ON public.modifier_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_modifier_options_updated_at
  BEFORE UPDATE ON public.modifier_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: SELECT to same-restaurant staff; no direct writes (RPC-only) --------
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_categories_select_same_restaurant
  ON public.menu_categories FOR SELECT
  TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY menu_items_select_same_restaurant
  ON public.menu_items FOR SELECT
  TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY modifier_groups_select_same_restaurant
  ON public.modifier_groups FOR SELECT
  TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY modifier_options_select_same_restaurant
  ON public.modifier_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.modifier_groups g
      WHERE g.id = modifier_options.group_id
        AND g.restaurant_id = public.auth_restaurant_id()
    )
  );

CREATE POLICY menu_item_modifier_groups_select_same_restaurant
  ON public.menu_item_modifier_groups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.menu_items i
      WHERE i.id = menu_item_modifier_groups.menu_item_id
        AND i.restaurant_id = public.auth_restaurant_id()
    )
  );

-- Widen audit allowlist for menu actions ----------------------------------
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS chk_audit_log_m1_actions;
ALTER TABLE public.audit_log
  ADD CONSTRAINT chk_audit_log_m1_actions CHECK (
    action IN (
      'auth.login',
      'auth.login_failed',
      'auth.logout',
      'auth.password_reset_requested',
      'auth.signup_completed',
      'staff.invited',
      'staff.created',
      'staff.updated',
      'staff.deactivated',
      'staff.reactivated',
      'staff.password_changed',
      'staff.pin_set',
      'staff.pin_verify_failed',
      'staff.owner_bootstrapped',
      'menu.category_created',
      'menu.category_updated',
      'menu.category_status_changed',
      'menu.item_created',
      'menu.item_updated',
      'menu.item_status_changed',
      'menu.modifier_group_created',
      'menu.modifier_group_updated',
      'menu.modifier_group_status_changed',
      'menu.modifier_option_created',
      'menu.modifier_option_updated',
      'menu.modifier_option_status_changed',
      'menu.item_modifiers_linked'
    )
  );

NOTIFY pgrst, 'reload schema';
