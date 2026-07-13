-- Bridge UX: return restaurant_name on pair + heartbeat (no queue logic change)

CREATE OR REPLACE FUNCTION public.pair_print_bridge(
  p_code text,
  p_display_name text DEFAULT NULL,
  p_device_name text DEFAULT NULL,
  p_windows_username text DEFAULT NULL,
  p_version text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pc public.print_bridge_pair_codes%ROWTYPE;
  v_token text;
  v_bridge uuid;
  v_prefix text;
  v_rest_name text;
BEGIN
  IF length(trim(coalesce(p_code, ''))) < 6 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

  SELECT * INTO v_pc FROM public.print_bridge_pair_codes
  WHERE code = upper(trim(p_code))
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_pc.restaurant_id;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := substr(v_token, 1, 8);

  INSERT INTO public.print_bridges (
    restaurant_id, display_name, device_name, windows_username, version,
    token_hash, token_prefix,
    last_heartbeat_at, last_connected_at, last_restart_at, is_active
  ) VALUES (
    v_pc.restaurant_id,
    coalesce(nullif(trim(coalesce(p_display_name, '')), ''), 'Bridge'),
    nullif(trim(coalesce(p_device_name, '')), ''),
    nullif(trim(coalesce(p_windows_username, '')), ''),
    nullif(trim(coalesce(p_version, '')), ''),
    public.m6_hash_token(v_token), v_prefix,
    now(), now(), now(), true
  ) RETURNING id INTO v_bridge;

  UPDATE public.print_bridge_pair_codes SET consumed_at = now() WHERE id = v_pc.id;

  RETURN jsonb_build_object(
    'bridge_id', v_bridge,
    'token', v_token,
    'token_prefix', v_prefix,
    'restaurant_id', v_pc.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم')
  );
END; $$;

DROP FUNCTION IF EXISTS public.bridge_heartbeat(text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(
  p_token text,
  p_device_name text DEFAULT NULL,
  p_windows_username text DEFAULT NULL,
  p_version text DEFAULT NULL,
  p_restarted boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_rest_name text;
BEGIN
  v_b := public.m6_require_bridge_token(p_token);
  UPDATE public.print_bridges SET
    device_name = coalesce(nullif(trim(coalesce(p_device_name, '')), ''), device_name),
    windows_username = coalesce(nullif(trim(coalesce(p_windows_username, '')), ''), windows_username),
    version = coalesce(nullif(trim(coalesce(p_version, '')), ''), version),
    last_heartbeat_at = now(),
    last_connected_at = now(),
    last_restart_at = CASE WHEN p_restarted THEN now() ELSE last_restart_at END,
    updated_at = now()
  WHERE id = v_b.id;

  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_b.restaurant_id;

  RETURN jsonb_build_object(
    'bridge_id', v_b.id,
    'restaurant_id', v_b.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم')
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(text, text, text, text, boolean) TO anon, authenticated;
