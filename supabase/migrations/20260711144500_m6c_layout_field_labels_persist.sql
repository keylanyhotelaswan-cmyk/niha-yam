-- Persist layout field label overrides (AR/EN) + value_format on save.
-- Previous m6_normalize_field_style dropped them → UI snapped back to defaults after save.

CREATE OR REPLACE FUNCTION public.m6_normalize_field_style(p_sec jsonb, p_def jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_mode text;
  v_fmt text;
BEGIN
  v := jsonb_build_object(
    'visible', coalesce((p_sec->>'visible')::boolean, (p_def->>'visible')::boolean, true),
    'font_pt', LEAST(40, GREATEST(10, coalesce((p_sec->>'font_pt')::int, (p_def->>'font_pt')::int, 16))),
    'align', CASE coalesce(p_sec->>'align', p_def->>'align', 'right')
      WHEN 'left' THEN 'left' WHEN 'center' THEN 'center' ELSE 'right' END,
    'bold', coalesce((p_sec->>'bold')::boolean, (p_def->>'bold')::boolean, false)
  );

  IF p_sec ? 'label_ar' AND jsonb_typeof(p_sec->'label_ar') = 'string' THEN
    v := v || jsonb_build_object('label_ar', p_sec->'label_ar');
  ELSIF p_def ? 'label_ar' AND jsonb_typeof(p_def->'label_ar') = 'string' THEN
    v := v || jsonb_build_object('label_ar', p_def->'label_ar');
  END IF;

  IF p_sec ? 'label_en' AND jsonb_typeof(p_sec->'label_en') = 'string' THEN
    v := v || jsonb_build_object('label_en', p_sec->'label_en');
  ELSIF p_def ? 'label_en' AND jsonb_typeof(p_def->'label_en') = 'string' THEN
    v := v || jsonb_build_object('label_en', p_def->'label_en');
  END IF;

  v_mode := coalesce(p_sec->>'label_mode', p_def->>'label_mode');
  IF v_mode IN ('ar', 'en', 'both', 'none') THEN
    v := v || jsonb_build_object('label_mode', v_mode);
  END IF;

  v_fmt := coalesce(p_sec->>'value_format', p_def->>'value_format');
  IF v_fmt IN ('default', 'number_only') THEN
    v := v || jsonb_build_object('value_format', v_fmt);
  END IF;

  RETURN v;
END;
$$;
