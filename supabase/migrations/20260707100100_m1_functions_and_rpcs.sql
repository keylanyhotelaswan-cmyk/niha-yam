-- M1: auth helpers and staff RPCs

CREATE OR REPLACE FUNCTION public.auth_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
  FROM public.staff s
  WHERE s.user_id = auth.uid()
    AND s.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.restaurant_id
  FROM public.staff s
  WHERE s.user_id = auth.uid()
    AND s.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.staff_role_rank(p_role public.staff_role)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 100
    WHEN 'manager' THEN 80
    WHEN 'cashier' THEN 60
    WHEN 'waiter' THEN 40
    WHEN 'kitchen' THEN 20
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_branch_access(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_branches sb
    WHERE sb.staff_id = public.auth_staff_id()
      AND sb.branch_id = p_branch_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_branch_role(
  p_branch_id uuid,
  p_required_role public.staff_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_branches sb
    WHERE sb.staff_id = public.auth_staff_id()
      AND sb.branch_id = p_branch_id
      AND public.staff_role_rank(sb.role) >= public.staff_role_rank(p_required_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_branches sb
    WHERE sb.staff_id = public.auth_staff_id()
      AND sb.role IN ('owner', 'manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_restaurant_id uuid,
  p_action text,
  p_branch_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_old_data jsonb DEFAULT NULL,
  p_new_data jsonb DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log (
    restaurant_id,
    branch_id,
    staff_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    correlation_id
  )
  VALUES (
    p_restaurant_id,
    p_branch_id,
    p_staff_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old_data,
    p_new_data,
    p_correlation_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  restaurant_name text,
  expires_at timestamptz,
  is_expired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.display_name,
    r.name,
    i.expires_at,
    (i.expires_at < now() OR i.accepted_at IS NOT NULL) AS is_expired
  FROM public.staff_invites i
  JOIN public.restaurants r ON r.id = i.restaurant_id
  WHERE i.token = p_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_owner_staff(
  p_user_id uuid,
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

  INSERT INTO public.staff (user_id, restaurant_id, display_name)
  VALUES (p_user_id, p_restaurant_id, p_display_name)
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
    jsonb_build_object('display_name', p_display_name, 'user_id', p_user_id)
  );

  RETURN v_staff_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_staff_invite(
  p_email text,
  p_display_name text,
  p_branch_assignments jsonb
)
RETURNS TABLE (invite_id uuid, token text, invite_url_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_staff_id uuid;
  v_token text;
  v_invite_id uuid;
BEGIN
  v_staff_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF v_staff_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_invites i
    WHERE i.restaurant_id = v_restaurant_id
      AND lower(i.email) = lower(p_email)
      AND i.accepted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'STAFF_EMAIL_EXISTS';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.staff_invites (
    restaurant_id,
    email,
    display_name,
    branch_assignments,
    token,
    invited_by,
    expires_at
  )
  VALUES (
    v_restaurant_id,
    lower(trim(p_email)),
    trim(p_display_name),
    p_branch_assignments,
    v_token,
    v_staff_id,
    now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.invited',
    NULL,
    v_staff_id,
    'staff_invite',
    v_invite_id,
    NULL,
    jsonb_build_object('email', lower(trim(p_email)), 'display_name', trim(p_display_name))
  );

  RETURN QUERY SELECT v_invite_id, v_token, '/signup?invite=' || v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_staff(
  p_staff_id uuid,
  p_display_name text,
  p_branch_assignments jsonb,
  p_is_active boolean DEFAULT true
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
  SET display_name = trim(p_display_name),
      is_active = p_is_active
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
    jsonb_build_object('display_name', trim(p_display_name), 'is_active', p_is_active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_staff(
  p_staff_id uuid,
  p_reason text
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

  UPDATE public.staff SET is_active = false WHERE id = p_staff_id;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.deactivated',
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    jsonb_build_object('reason', p_reason)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_pin(
  p_staff_id uuid,
  p_pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF v_actor_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF length(p_pin) < 4 OR length(p_pin) > 6 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_PIN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND';
  END IF;

  UPDATE public.staff
  SET pin_hash = crypt(p_pin, gen_salt('bf'))
  WHERE id = p_staff_id;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.pin_set',
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  p_staff_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_hash text;
  v_ok boolean;
BEGIN
  v_restaurant_id := public.auth_restaurant_id();

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT pin_hash INTO v_hash
  FROM public.staff
  WHERE id = p_staff_id AND restaurant_id = v_restaurant_id AND is_active = true;

  v_ok := v_hash IS NOT NULL AND v_hash = crypt(p_pin, v_hash);

  IF NOT v_ok THEN
    PERFORM public.log_audit_event(
      v_restaurant_id,
      'staff.pin_verify_failed',
      NULL,
      public.auth_staff_id(),
      'staff',
      p_staff_id,
      NULL,
      NULL
    );
  END IF;

  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_auth_event(
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_staff_id uuid;
  v_id uuid;
BEGIN
  v_staff_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF p_action NOT IN (
    'auth.login',
    'auth.login_failed',
    'auth.logout',
    'auth.password_reset_requested',
    'auth.signup_completed'
  ) THEN
    RAISE EXCEPTION 'INVALID_AUTH_ACTION';
  END IF;

  IF p_action = 'auth.login_failed' THEN
    INSERT INTO public.audit_log (restaurant_id, staff_id, action, new_data)
    VALUES (NULL, NULL, p_action, p_metadata)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'NO_RESTAURANT';
  END IF;

  RETURN public.log_audit_event(
    v_restaurant_id,
    p_action,
    NULL,
    v_staff_id,
    'auth',
    NULL,
    NULL,
    p_metadata
  );
END;
$$;

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
  WHERE user_id = auth.uid() AND is_active = true;

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

GRANT EXECUTE ON FUNCTION public.get_my_staff_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE (
  id uuid,
  user_id uuid,
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

GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_staff(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_invite(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_staff(uuid, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_staff(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_auth_event(text, jsonb) TO anon, authenticated;
