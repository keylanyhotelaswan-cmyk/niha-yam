-- M2: get_my_staff_profile returns the caller's profile even when deactivated,
-- so the app can distinguish "account disabled" from "no staff profile" and show
-- an accurate message. The app still gates access on is_active = false.

CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_branches jsonb;
BEGIN
  SELECT * INTO v_staff
  FROM public.staff
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'branch_id', sb.branch_id,
      'role', sb.role,
      'branch_name', b.name,
      'branch_code', b.code
    )
  ), '[]'::jsonb)
  INTO v_branches
  FROM public.staff_branches sb
  JOIN public.branches b ON b.id = sb.branch_id
  WHERE sb.staff_id = v_staff.id;

  RETURN jsonb_build_object(
    'id', v_staff.id,
    'user_id', v_staff.user_id,
    'restaurant_id', v_staff.restaurant_id,
    'display_name', v_staff.display_name,
    'is_active', v_staff.is_active,
    'branches', v_branches
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
