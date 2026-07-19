-- Ops purchase UX: create ingredient + list UOMs for staff with operational purchase.
-- Does not change PURA money/posting logic.

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

CREATE OR REPLACE FUNCTION public.pur_create_ops_ingredient(
  p_name_ar text,
  p_base_uom_id uuid,
  p_standard_cost numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
  v_staff uuid := public.auth_staff_id();
  v_id uuid;
BEGIN
  IF length(trim(coalesce(p_name_ar, ''))) = 0 THEN
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

  INSERT INTO public.ingredients (
    restaurant_id, name_ar, name_en, code, base_uom_id,
    cost_mode, standard_cost, is_active
  ) VALUES (
    v_rest, trim(p_name_ar), NULL, NULL,
    p_base_uom_id, 'standard', coalesce(p_standard_cost, 0), true
  )
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    v_rest, 'recipes.ingredient_upserted', NULL, v_staff,
    'ingredient', v_id, NULL,
    jsonb_build_object('name_ar', trim(p_name_ar), 'via', 'ops_purchase')
  );

  RETURN (
    SELECT row_to_json(x)::jsonb FROM (
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
      WHERE i.id = v_id
    ) x
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pur_list_ops_uoms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_create_ops_ingredient(text, uuid, numeric) TO authenticated;
