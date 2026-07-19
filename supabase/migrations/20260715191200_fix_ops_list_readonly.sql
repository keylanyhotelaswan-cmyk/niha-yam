-- Fix: STABLE ops list RPCs must not INSERT (same root cause as list_uoms readonly fix).
-- Seed UOMs via volatile pur_bootstrap_ops_uoms only.

CREATE OR REPLACE FUNCTION public.pur_list_ops_uoms()
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
    SELECT jsonb_agg(row_to_json(u)::jsonb ORDER BY u.code)
    FROM (
      SELECT id, code, name_ar
      FROM public.uoms
      WHERE restaurant_id = v_rest
    ) u
  ), '[]'::jsonb);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.pur_bootstrap_ops_uoms()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
BEGIN
  PERFORM public.rc_ensure_default_uoms(v_rest);
  RETURN public.pur_list_ops_uoms();
END;
$$;

GRANT EXECUTE ON FUNCTION public.pur_bootstrap_ops_uoms() TO authenticated;

NOTIFY pgrst, 'reload schema';
