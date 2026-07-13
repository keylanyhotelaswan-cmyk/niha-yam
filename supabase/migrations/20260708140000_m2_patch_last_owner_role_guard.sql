-- M2 patch (D1): prevent demoting the sole active owner via update_staff role change.
-- set_staff_status already guards deactivation; this closes the role-edit gap.

CREATE OR REPLACE FUNCTION public.update_staff(
  p_staff_id uuid,
  p_display_name text,
  p_branch_assignments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_actor_id uuid;
  v_assignment jsonb;
  v_owner_count int;
BEGIN
  v_actor_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF v_actor_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND';
  END IF;

  -- Last-owner guard on role demotion (mirrors set_staff_status deactivation guard).
  IF EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = p_staff_id AND sb.role = 'owner'
  ) THEN
    SELECT count(*)::int INTO v_owner_count
    FROM public.staff_branches sb
    JOIN public.staff s ON s.id = sb.staff_id
    WHERE s.restaurant_id = v_restaurant_id
      AND sb.role = 'owner'
      AND s.is_active = true;

    IF v_owner_count <= 1 AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_branch_assignments) elem
      WHERE (elem ->> 'role') = 'owner'
    ) THEN
      RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
    END IF;
  END IF;

  UPDATE public.staff
  SET display_name = trim(p_display_name)
  WHERE id = p_staff_id;

  DELETE FROM public.staff_branches WHERE staff_id = p_staff_id;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(p_branch_assignments)
  LOOP
    INSERT INTO public.staff_branches (staff_id, branch_id, role)
    VALUES (
      p_staff_id,
      (v_assignment ->> 'branch_id')::uuid,
      (v_assignment ->> 'role')::public.staff_role
    );
  END LOOP;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.updated',
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    jsonb_build_object('display_name', trim(p_display_name))
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
