-- M1 fix: pgcrypto functions live in the `extensions` schema on Supabase, but the
-- SECURITY DEFINER RPCs pin `search_path = public`, so unqualified calls to
-- gen_random_bytes()/crypt()/gen_salt() fail with "function ... does not exist".
-- Fix: schema-qualify all pgcrypto calls with `extensions.` (see ADR-0015).
-- Append-only: original migrations already applied; these CREATE OR REPLACE the
-- affected functions with qualified calls.

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

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

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
  SET pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
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

  v_ok := v_hash IS NOT NULL AND v_hash = extensions.crypt(p_pin, v_hash);

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
