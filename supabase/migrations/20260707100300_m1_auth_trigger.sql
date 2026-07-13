-- M1: auth.users trigger for invite acceptance

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_invite public.staff_invites%ROWTYPE;
  v_staff_id uuid;
  v_assignment jsonb;
BEGIN
  v_token := NEW.raw_user_meta_data ->> 'invite_token';

  IF v_token IS NULL OR length(v_token) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_invite
  FROM public.staff_invites
  WHERE token = v_token
    AND accepted_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_INVALID';
  END IF;

  IF lower(NEW.email) <> lower(v_invite.email) THEN
    RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH';
  END IF;

  INSERT INTO public.staff (user_id, restaurant_id, display_name)
  VALUES (NEW.id, v_invite.restaurant_id, v_invite.display_name)
  RETURNING id INTO v_staff_id;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_invite.branch_assignments)
  LOOP
    INSERT INTO public.staff_branches (staff_id, branch_id, role)
    VALUES (
      v_staff_id,
      (v_assignment ->> 'branch_id')::uuid,
      (v_assignment ->> 'role')::public.staff_role
    );
  END LOOP;

  UPDATE public.staff_invites
  SET accepted_at = now()
  WHERE id = v_invite.id;

  PERFORM public.log_audit_event(
    v_invite.restaurant_id,
    'staff.created',
    NULL,
    v_staff_id,
    'staff',
    v_staff_id,
    NULL,
    jsonb_build_object('email', NEW.email, 'via', 'invite')
  );

  PERFORM public.log_audit_event(
    v_invite.restaurant_id,
    'auth.signup_completed',
    NULL,
    v_staff_id,
    'auth',
    NULL,
    NULL,
    jsonb_build_object('email', NEW.email)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
