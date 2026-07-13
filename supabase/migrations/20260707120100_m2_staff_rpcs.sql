-- M2: Staff direct-creation RPCs.
-- Extension functions are schema-qualified (ADR-0015). SECURITY DEFINER + fixed search_path.

-- provision_staff: called by the staff-create Edge Function AFTER it has created the
-- auth.users row with the service role. Inserts the staff row + single branch role
-- (+ optional PIN) and audits. Runs under service_role, so it cannot use auth.uid();
-- the actor is passed explicitly and re-checked here.
CREATE OR REPLACE FUNCTION public.provision_staff(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_role public.staff_role,
  p_is_active boolean,
  p_pin text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_staff_id uuid;
  v_restaurant_id uuid;
  v_branch_id uuid;
  v_username text;
  v_staff_id uuid;
BEGIN
  -- Resolve + authorize the actor (owner/manager) without auth.uid().
  SELECT s.id, s.restaurant_id INTO v_actor_staff_id, v_restaurant_id
  FROM public.staff s
  WHERE s.user_id = p_actor_user_id AND s.is_active = true;

  IF v_actor_staff_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = v_actor_staff_id AND sb.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  -- Single-branch resolution (ADR-0017).
  SELECT b.id INTO v_branch_id
  FROM public.branches b
  WHERE b.restaurant_id = v_restaurant_id AND b.is_active = true
  ORDER BY b.created_at
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  v_username := lower(trim(p_username));

  IF v_username !~ '^[a-z0-9._-]{3,32}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME';
  END IF;

  IF p_pin IS NOT NULL AND (length(p_pin) < 4 OR length(p_pin) > 6 OR p_pin !~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'INVALID_PIN';
  END IF;

  BEGIN
    INSERT INTO public.staff (user_id, restaurant_id, username, display_name, email, is_active, pin_hash)
    VALUES (
      p_user_id,
      v_restaurant_id,
      v_username,
      trim(p_display_name),
      nullif(trim(coalesce(p_email, '')), ''),
      coalesce(p_is_active, true),
      CASE WHEN p_pin IS NULL THEN NULL
           ELSE extensions.crypt(p_pin, extensions.gen_salt('bf')) END
    )
    RETURNING id INTO v_staff_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'USERNAME_EXISTS';
  END;

  INSERT INTO public.staff_branches (staff_id, branch_id, role)
  VALUES (v_staff_id, v_branch_id, p_role);

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.created',
    v_branch_id,
    v_actor_staff_id,
    'staff',
    v_staff_id,
    NULL,
    jsonb_build_object('username', v_username, 'display_name', trim(p_display_name), 'role', p_role)
  );

  IF p_pin IS NOT NULL THEN
    PERFORM public.log_audit_event(
      v_restaurant_id, 'staff.pin_set', v_branch_id, v_actor_staff_id, 'staff', v_staff_id, NULL, NULL
    );
  END IF;

  RETURN v_staff_id;
END;
$$;

-- update_staff: name + single role only. Status goes through set_staff_status;
-- username is immutable (never touched here). Replaces the M1 4-arg signature.
DROP FUNCTION IF EXISTS public.update_staff(uuid, text, jsonb, boolean);

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

-- set_staff_status: activate/deactivate with distinct audit events.
-- Keeps no-self-deactivate + last-active-owner guards. Replaces deactivate_staff.
DROP FUNCTION IF EXISTS public.deactivate_staff(uuid, text);

CREATE OR REPLACE FUNCTION public.set_staff_status(
  p_staff_id uuid,
  p_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_actor_id uuid;
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

  IF p_active = false THEN
    IF p_staff_id = v_actor_id THEN
      RAISE EXCEPTION 'CANNOT_DEACTIVATE_SELF';
    END IF;

    SELECT count(*)::int INTO v_owner_count
    FROM public.staff_branches sb
    JOIN public.staff s ON s.id = sb.staff_id
    WHERE s.restaurant_id = v_restaurant_id
      AND sb.role = 'owner'
      AND s.is_active = true;

    IF v_owner_count <= 1 AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
      WHERE sb.staff_id = p_staff_id AND sb.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
    END IF;
  END IF;

  UPDATE public.staff SET is_active = p_active WHERE id = p_staff_id;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    CASE WHEN p_active THEN 'staff.reactivated' ELSE 'staff.deactivated' END,
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    CASE WHEN p_reason IS NULL THEN NULL ELSE jsonb_build_object('reason', p_reason) END
  );
END;
$$;

-- list_staff: add username to the projection (rebuild — return shape changes).
DROP FUNCTION IF EXISTS public.list_staff();

CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  is_active boolean,
  branches jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    s.username,
    s.display_name,
    s.is_active,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'branch_id', sb.branch_id,
            'role', sb.role,
            'branch_name', b.name
          )
        )
        FROM public.staff_branches sb
        JOIN public.branches b ON b.id = sb.branch_id
        WHERE sb.staff_id = s.id
      ),
      '[]'::jsonb
    ),
    s.created_at
  FROM public.staff s
  WHERE s.restaurant_id = public.auth_restaurant_id()
  ORDER BY s.display_name;
END;
$$;

-- bootstrap_owner_staff: now takes a username (re-bootstrap on the username model, ADR-0018/Q-C).
DROP FUNCTION IF EXISTS public.bootstrap_owner_staff(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.bootstrap_owner_staff(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_restaurant_id uuid,
  p_branch_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_username text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff) THEN
    RAISE EXCEPTION 'BOOTSTRAP_ALREADY_DONE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id AND b.restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND';
  END IF;

  v_username := lower(trim(p_username));
  IF v_username !~ '^[a-z0-9._-]{3,32}$' THEN
    RAISE EXCEPTION 'INVALID_USERNAME';
  END IF;

  INSERT INTO public.staff (user_id, restaurant_id, username, display_name)
  VALUES (p_user_id, p_restaurant_id, v_username, p_display_name)
  RETURNING id INTO v_staff_id;

  INSERT INTO public.staff_branches (staff_id, branch_id, role)
  VALUES (v_staff_id, p_branch_id, 'owner');

  PERFORM public.log_audit_event(
    p_restaurant_id,
    'staff.owner_bootstrapped',
    p_branch_id,
    v_staff_id,
    'staff',
    v_staff_id,
    NULL,
    jsonb_build_object('username', v_username, 'display_name', p_display_name, 'user_id', p_user_id)
  );

  RETURN v_staff_id;
END;
$$;

-- record_password_change: audit hook for the staff-reset-password Edge Function.
-- The password change happens via the GoTrue Admin API; this only writes the audit row.
-- Runs under service_role (no auth.uid()); actor is passed + re-checked.
CREATE OR REPLACE FUNCTION public.record_password_change(
  p_actor_user_id uuid,
  p_staff_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_staff_id uuid;
  v_restaurant_id uuid;
BEGIN
  SELECT s.id, s.restaurant_id INTO v_actor_staff_id, v_restaurant_id
  FROM public.staff s
  WHERE s.user_id = p_actor_user_id AND s.is_active = true;

  IF v_actor_staff_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = v_actor_staff_id AND sb.role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND';
  END IF;

  PERFORM public.log_audit_event(
    v_restaurant_id, 'staff.password_changed', NULL, v_actor_staff_id, 'staff', p_staff_id, NULL, NULL
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.provision_staff(uuid, uuid, text, text, public.staff_role, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_password_change(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_staff(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_status(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_staff(uuid, text, text, uuid, uuid) TO service_role;

-- Reload the PostgREST schema cache so the new/changed function signatures are
-- resolvable immediately after `supabase db push` (prevents PGRST202 on first call).
NOTIFY pgrst, 'reload schema';
