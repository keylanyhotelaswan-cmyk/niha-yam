-- Fix: list_uoms must not INSERT (STABLE / read-only). Seed via volatile paths only.

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

-- Volatile bootstrap for UoMs (call from UI on first open / writes)
CREATE OR REPLACE FUNCTION public.rc_bootstrap_uoms()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.rc_require_manager();
BEGIN
  PERFORM public.rc_ensure_default_uoms(v_rest);
  RETURN public.list_uoms();
END;
$$;

GRANT EXECUTE ON FUNCTION public.rc_bootstrap_uoms() TO authenticated;

NOTIFY pgrst, 'reload schema';
