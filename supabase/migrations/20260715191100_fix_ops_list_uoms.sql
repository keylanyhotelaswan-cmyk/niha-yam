-- Fix pur_list_ops_uoms: uoms has no sort_order column.

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
  PERFORM public.rc_ensure_default_uoms(v_rest);
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
