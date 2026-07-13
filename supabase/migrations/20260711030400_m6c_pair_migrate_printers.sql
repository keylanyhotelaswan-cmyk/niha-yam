-- When re-pairing Bridge on same PC, migrate printer bindings so jobs are claimable.

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
  v_device text := nullif(trim(coalesce(p_device_name, '')), '');
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
    v_device,
    nullif(trim(coalesce(p_windows_username, '')), ''),
    nullif(trim(coalesce(p_version, '')), ''),
    public.m6_hash_token(v_token), v_prefix,
    now(), now(), now(), true
  ) RETURNING id INTO v_bridge;

  -- Same machine re-pair: retire prior bridges and keep printer assignments working.
  IF v_device IS NOT NULL THEN
    UPDATE public.print_bridges
    SET is_active = false, updated_at = now()
    WHERE restaurant_id = v_pc.restaurant_id
      AND id <> v_bridge
      AND device_name IS NOT NULL
      AND lower(device_name) = lower(v_device);

    UPDATE public.printers
    SET bridge_id = v_bridge, updated_at = now()
    WHERE restaurant_id = v_pc.restaurant_id
      AND (
        bridge_id IS NULL
        OR bridge_id IN (
          SELECT id FROM public.print_bridges
          WHERE restaurant_id = v_pc.restaurant_id
            AND device_name IS NOT NULL
            AND lower(device_name) = lower(v_device)
        )
      );
  ELSE
    -- No device name: still move unbound printers to the new bridge.
    UPDATE public.printers
    SET bridge_id = v_bridge, updated_at = now()
    WHERE restaurant_id = v_pc.restaurant_id
      AND bridge_id IS NULL;
  END IF;

  UPDATE public.print_bridge_pair_codes SET consumed_at = now() WHERE id = v_pc.id;

  RETURN jsonb_build_object(
    'bridge_id', v_bridge,
    'token', v_token,
    'token_prefix', v_prefix,
    'restaurant_id', v_pc.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم')
  );
END; $$;

NOTIFY pgrst, 'reload schema';
