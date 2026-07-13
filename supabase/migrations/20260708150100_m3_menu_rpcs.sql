-- M3: Menu & Products RPCs. All SECURITY DEFINER + fixed search_path.
-- Writes require owner/manager; reads split admin (manager) vs POS (any active staff).

-- Internal guard: returns caller restaurant_id or raises. Manager/owner only.
CREATE OR REPLACE FUNCTION public.menu_require_manager()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  v_restaurant_id := public.auth_restaurant_id();
  IF v_restaurant_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  RETURN v_restaurant_id;
END;
$$;

-- Categories --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_menu_category(
  p_id uuid,
  p_name text,
  p_sort_order int,
  p_show_in_pos boolean,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
  v_id uuid;
  v_is_new boolean := p_id IS NULL;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  IF v_is_new THEN
    INSERT INTO public.menu_categories (restaurant_id, name, sort_order, show_in_pos, is_active)
    VALUES (v_restaurant_id, trim(p_name), coalesce(p_sort_order, 0),
            coalesce(p_show_in_pos, true), coalesce(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.menu_categories
    SET name = trim(p_name),
        sort_order = coalesce(p_sort_order, 0),
        show_in_pos = coalesce(p_show_in_pos, true),
        is_active = coalesce(p_is_active, true)
    WHERE id = p_id AND restaurant_id = v_restaurant_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    CASE WHEN v_is_new THEN 'menu.category_created' ELSE 'menu.category_updated' END,
    NULL, public.auth_staff_id(), 'menu_category', v_id, NULL,
    jsonb_build_object('name', trim(p_name))
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_menu_category_status(
  p_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  UPDATE public.menu_categories
  SET is_active = p_active
  WHERE id = p_id AND restaurant_id = v_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'menu.category_status_changed', NULL, public.auth_staff_id(),
    'menu_category', p_id, NULL, jsonb_build_object('is_active', p_active)
  );
END;
$$;

-- Items -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_menu_item(
  p_id uuid,
  p_category_id uuid,
  p_name text,
  p_sku text,
  p_base_price numeric,
  p_sort_order int,
  p_show_in_pos boolean,
  p_needs_kitchen boolean,
  p_needs_print boolean,
  p_accepts_modifiers boolean,
  p_allows_discounts boolean,
  p_is_open_price boolean,
  p_is_favorite boolean,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
  v_id uuid;
  v_is_new boolean := p_id IS NULL;
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_show boolean := coalesce(p_show_in_pos, true);
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  IF coalesce(p_base_price, 0) < 0 THEN
    RAISE EXCEPTION 'INVALID_PRICE';
  END IF;

  -- S6: POS-visible item must have a category.
  IF v_show = true AND p_category_id IS NULL THEN
    RAISE EXCEPTION 'POS_REQUIRES_CATEGORY';
  END IF;

  -- Category (when set) must belong to the same restaurant.
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.menu_categories c
    WHERE c.id = p_category_id AND c.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  BEGIN
    IF v_is_new THEN
      INSERT INTO public.menu_items (
        restaurant_id, category_id, name, sku, base_price, sort_order, show_in_pos,
        needs_kitchen, needs_print, accepts_modifiers, allows_discounts,
        is_open_price, is_favorite, is_active, description
      )
      VALUES (
        v_restaurant_id, p_category_id, trim(p_name), v_sku, coalesce(p_base_price, 0),
        coalesce(p_sort_order, 0), v_show, coalesce(p_needs_kitchen, true),
        coalesce(p_needs_print, true), coalesce(p_accepts_modifiers, false),
        coalesce(p_allows_discounts, true), coalesce(p_is_open_price, false),
        coalesce(p_is_favorite, false), true, nullif(trim(coalesce(p_description, '')), '')
      )
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.menu_items
      SET category_id = p_category_id,
          name = trim(p_name),
          sku = v_sku,
          base_price = coalesce(p_base_price, 0),
          sort_order = coalesce(p_sort_order, 0),
          show_in_pos = v_show,
          needs_kitchen = coalesce(p_needs_kitchen, true),
          needs_print = coalesce(p_needs_print, true),
          accepts_modifiers = coalesce(p_accepts_modifiers, false),
          allows_discounts = coalesce(p_allows_discounts, true),
          is_open_price = coalesce(p_is_open_price, false),
          is_favorite = coalesce(p_is_favorite, false),
          description = nullif(trim(coalesce(p_description, '')), '')
      WHERE id = p_id AND restaurant_id = v_restaurant_id
      RETURNING id INTO v_id;

      IF v_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SKU_EXISTS';
  END;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    CASE WHEN v_is_new THEN 'menu.item_created' ELSE 'menu.item_updated' END,
    NULL, public.auth_staff_id(), 'menu_item', v_id, NULL,
    jsonb_build_object('name', trim(p_name), 'sku', v_sku)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_menu_item_status(
  p_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  UPDATE public.menu_items
  SET is_active = p_active
  WHERE id = p_id AND restaurant_id = v_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'menu.item_status_changed', NULL, public.auth_staff_id(),
    'menu_item', p_id, NULL, jsonb_build_object('is_active', p_active)
  );
END;
$$;

-- Modifier groups ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_modifier_group(
  p_id uuid,
  p_name text,
  p_min_selections int,
  p_max_selections int,
  p_sort_order int,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
  v_id uuid;
  v_is_new boolean := p_id IS NULL;
  v_min int := coalesce(p_min_selections, 0);
  v_max int := coalesce(p_max_selections, 1);
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  IF v_min < 0 OR (v_max <> 0 AND v_max < v_min) THEN
    RAISE EXCEPTION 'INVALID_SELECTION_RANGE';
  END IF;

  IF v_is_new THEN
    INSERT INTO public.modifier_groups (restaurant_id, name, min_selections, max_selections, sort_order, is_active)
    VALUES (v_restaurant_id, trim(p_name), v_min, v_max, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.modifier_groups
    SET name = trim(p_name),
        min_selections = v_min,
        max_selections = v_max,
        sort_order = coalesce(p_sort_order, 0),
        is_active = coalesce(p_is_active, true)
    WHERE id = p_id AND restaurant_id = v_restaurant_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    CASE WHEN v_is_new THEN 'menu.modifier_group_created' ELSE 'menu.modifier_group_updated' END,
    NULL, public.auth_staff_id(), 'modifier_group', v_id, NULL,
    jsonb_build_object('name', trim(p_name))
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_modifier_group_status(
  p_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  UPDATE public.modifier_groups
  SET is_active = p_active
  WHERE id = p_id AND restaurant_id = v_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'menu.modifier_group_status_changed', NULL, public.auth_staff_id(),
    'modifier_group', p_id, NULL, jsonb_build_object('is_active', p_active)
  );
END;
$$;

-- Modifier options --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_modifier_option(
  p_id uuid,
  p_group_id uuid,
  p_name text,
  p_price_delta numeric,
  p_sort_order int,
  p_is_default boolean,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
  v_id uuid;
  v_is_new boolean := p_id IS NULL;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  -- Parent group must belong to the caller's restaurant.
  IF NOT EXISTS (
    SELECT 1 FROM public.modifier_groups g
    WHERE g.id = p_group_id AND g.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_is_new THEN
    INSERT INTO public.modifier_options (group_id, name, price_delta, sort_order, is_default, is_active)
    VALUES (p_group_id, trim(p_name), coalesce(p_price_delta, 0), coalesce(p_sort_order, 0),
            coalesce(p_is_default, false), coalesce(p_is_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.modifier_options
    SET group_id = p_group_id,
        name = trim(p_name),
        price_delta = coalesce(p_price_delta, 0),
        sort_order = coalesce(p_sort_order, 0),
        is_default = coalesce(p_is_default, false),
        is_active = coalesce(p_is_active, true)
    WHERE id = p_id AND group_id = p_group_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    CASE WHEN v_is_new THEN 'menu.modifier_option_created' ELSE 'menu.modifier_option_updated' END,
    NULL, public.auth_staff_id(), 'modifier_option', v_id, NULL,
    jsonb_build_object('name', trim(p_name), 'group_id', p_group_id)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_modifier_option_status(
  p_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  UPDATE public.modifier_options o
  SET is_active = p_active
  FROM public.modifier_groups g
  WHERE o.id = p_id AND o.group_id = g.id AND g.restaurant_id = v_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'menu.modifier_option_status_changed', NULL, public.auth_staff_id(),
    'modifier_option', p_id, NULL, jsonb_build_object('is_active', p_active)
  );
END;
$$;

-- Item ↔ group links (replace whole set) ----------------------------------
CREATE OR REPLACE FUNCTION public.link_item_modifier_groups(
  p_item_id uuid,
  p_links jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
  v_link jsonb;
  v_group_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.menu_items i
    WHERE i.id = p_item_id AND i.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_links IS NULL OR jsonb_typeof(p_links) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_LINKS';
  END IF;

  DELETE FROM public.menu_item_modifier_groups WHERE menu_item_id = p_item_id;

  FOR v_link IN SELECT value FROM jsonb_array_elements(p_links)
  LOOP
    v_group_id := (v_link ->> 'modifier_group_id')::uuid;

    -- Each group must belong to the same restaurant.
    IF NOT EXISTS (
      SELECT 1 FROM public.modifier_groups g
      WHERE g.id = v_group_id AND g.restaurant_id = v_restaurant_id
    ) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;

    INSERT INTO public.menu_item_modifier_groups (menu_item_id, modifier_group_id, sort_order)
    VALUES (p_item_id, v_group_id, coalesce((v_link ->> 'sort_order')::int, 0));
  END LOOP;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'menu.item_modifiers_linked', NULL, public.auth_staff_id(),
    'menu_item', p_item_id, NULL, p_links
  );
END;
$$;

-- Reads: admin ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_menu_admin()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  RETURN jsonb_build_object(
    'categories', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'sort_order', c.sort_order,
          'show_in_pos', c.show_in_pos,
          'is_active', c.is_active
        ) ORDER BY c.sort_order, c.name
      )
      FROM public.menu_categories c
      WHERE c.restaurant_id = v_restaurant_id
    ), '[]'::jsonb),
    'items', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'category_id', i.category_id,
          'name', i.name,
          'sku', i.sku,
          'base_price', i.base_price,
          'sort_order', i.sort_order,
          'show_in_pos', i.show_in_pos,
          'needs_kitchen', i.needs_kitchen,
          'needs_print', i.needs_print,
          'accepts_modifiers', i.accepts_modifiers,
          'allows_discounts', i.allows_discounts,
          'is_open_price', i.is_open_price,
          'is_favorite', i.is_favorite,
          'is_active', i.is_active,
          'description', i.description,
          'modifier_group_ids', coalesce((
            SELECT jsonb_agg(l.modifier_group_id ORDER BY l.sort_order)
            FROM public.menu_item_modifier_groups l
            WHERE l.menu_item_id = i.id
          ), '[]'::jsonb)
        ) ORDER BY i.sort_order, i.name
      )
      FROM public.menu_items i
      WHERE i.restaurant_id = v_restaurant_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_modifier_groups_admin()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid := public.menu_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'min_selections', g.min_selections,
        'max_selections', g.max_selections,
        'sort_order', g.sort_order,
        'is_active', g.is_active,
        'options', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'name', o.name,
              'price_delta', o.price_delta,
              'sort_order', o.sort_order,
              'is_default', o.is_default,
              'is_active', o.is_active
            ) ORDER BY o.sort_order, o.name
          )
          FROM public.modifier_options o
          WHERE o.group_id = g.id
        ), '[]'::jsonb)
      ) ORDER BY g.sort_order, g.name
    )
    FROM public.modifier_groups g
    WHERE g.restaurant_id = v_restaurant_id
  ), '[]'::jsonb);
END;
$$;

-- Reads: POS contract (any active staff) ----------------------------------
-- Returns only active + show_in_pos categories/items; empty categories omitted;
-- modifier trees nested for items that accept modifiers.
CREATE OR REPLACE FUNCTION public.list_menu_for_pos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  v_restaurant_id := public.auth_restaurant_id();
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN jsonb_build_object(
    'categories', coalesce((
      SELECT jsonb_agg(cat ORDER BY cat_sort, cat_name)
      FROM (
        SELECT
          c.sort_order AS cat_sort,
          c.name AS cat_name,
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'sort_order', c.sort_order,
            'items', items.items_json
          ) AS cat
        FROM public.menu_categories c
        JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', i.id,
              'name', i.name,
              'sku', i.sku,
              'base_price', i.base_price,
              'sort_order', i.sort_order,
              'needs_kitchen', i.needs_kitchen,
              'needs_print', i.needs_print,
              'accepts_modifiers', i.accepts_modifiers,
              'allows_discounts', i.allows_discounts,
              'is_open_price', i.is_open_price,
              'is_favorite', i.is_favorite,
              'modifier_groups', CASE
                WHEN i.accepts_modifiers THEN coalesce((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', g.id,
                      'name', g.name,
                      'min_selections', g.min_selections,
                      'max_selections', g.max_selections,
                      'options', coalesce((
                        SELECT jsonb_agg(
                          jsonb_build_object(
                            'id', o.id,
                            'name', o.name,
                            'price_delta', o.price_delta,
                            'is_default', o.is_default
                          ) ORDER BY o.sort_order, o.name
                        )
                        FROM public.modifier_options o
                        WHERE o.group_id = g.id AND o.is_active = true
                      ), '[]'::jsonb)
                    ) ORDER BY l.sort_order, g.sort_order
                  )
                  FROM public.menu_item_modifier_groups l
                  JOIN public.modifier_groups g ON g.id = l.modifier_group_id
                  WHERE l.menu_item_id = i.id AND g.is_active = true
                ), '[]'::jsonb)
                ELSE '[]'::jsonb
              END
            ) ORDER BY i.sort_order, i.name
          ) AS items_json
          FROM public.menu_items i
          WHERE i.category_id = c.id
            AND i.restaurant_id = v_restaurant_id
            AND i.is_active = true
            AND i.show_in_pos = true
        ) items ON items.items_json IS NOT NULL
        WHERE c.restaurant_id = v_restaurant_id
          AND c.is_active = true
          AND c.show_in_pos = true
      ) ordered
    ), '[]'::jsonb)
  );
END;
$$;

-- Grants ------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.upsert_menu_category(uuid, text, int, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_menu_category_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_menu_item(uuid, uuid, text, text, numeric, int, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_menu_item_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_modifier_group(uuid, text, int, int, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_modifier_group_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_modifier_option(uuid, uuid, text, numeric, int, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_modifier_option_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_item_modifier_groups(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_menu_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_modifier_groups_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_menu_for_pos() TO authenticated;

NOTIFY pgrst, 'reload schema';
