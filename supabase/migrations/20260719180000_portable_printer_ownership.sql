-- Portable printer ownership: Pair / sole-printer inventory follows the current device.
-- Confirmed ops bug: one thermal moved between PCs left printers on an older online Bridge
-- while the new Bridge stayed Connected but claim returned [] / JOB_ROUTED_TO_OTHER_ONLINE_BRIDGE.

-- ---------------------------------------------------------------------------
-- Transfer all restaurant printers + open jobs to the given active Bridge,
-- and soft-deactivate every other Bridge for that restaurant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_transfer_restaurant_print_ownership(p_bridge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_printers int := 0;
  v_jobs int := 0;
  v_peers int := 0;
BEGIN
  SELECT * INTO v_b FROM public.print_bridges WHERE id = p_bridge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BRIDGE_NOT_FOUND');
  END IF;

  UPDATE public.print_bridges
  SET is_active = true, updated_at = now()
  WHERE id = p_bridge_id
    AND is_active IS DISTINCT FROM true;

  UPDATE public.print_bridges
  SET is_active = false, updated_at = now()
  WHERE restaurant_id = v_b.restaurant_id
    AND id <> p_bridge_id
    AND is_active;
  GET DIAGNOSTICS v_peers = ROW_COUNT;

  UPDATE public.printers
  SET bridge_id = p_bridge_id, updated_at = now()
  WHERE restaurant_id = v_b.restaurant_id
    AND bridge_id IS DISTINCT FROM p_bridge_id;
  GET DIAGNOSTICS v_printers = ROW_COUNT;

  UPDATE public.print_jobs
  SET
    bridge_id = p_bridge_id,
    status = CASE WHEN status = 'claimed' THEN 'pending' ELSE status END,
    claimed_by = CASE WHEN status = 'claimed' THEN NULL ELSE claimed_by END,
    claimed_at = CASE WHEN status = 'claimed' THEN NULL ELSE claimed_at END,
    updated_at = now()
  WHERE restaurant_id = v_b.restaurant_id
    AND status IN ('pending', 'retry_wait', 'claimed')
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      bridge_id IS DISTINCT FROM p_bridge_id
      OR status = 'claimed'
    );
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'bridge_id', p_bridge_id,
    'printers_moved', v_printers,
    'jobs_rerouted', v_jobs,
    'peers_deactivated', v_peers
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Pair: new Bridge becomes sole owner for the restaurant (any device).
-- ---------------------------------------------------------------------------
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
  v_xfer jsonb;
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

  v_xfer := public.m6_transfer_restaurant_print_ownership(v_bridge);

  UPDATE public.print_bridge_pair_codes SET consumed_at = now() WHERE id = v_pc.id;

  RETURN jsonb_build_object(
    'bridge_id', v_bridge,
    'token', v_token,
    'token_prefix', v_prefix,
    'restaurant_id', v_pc.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'ownership', v_xfer
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Auto-bind: sole logical printer + local thermal → take ownership even if
-- the previous Bridge is still online (printer moved to another PC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_auto_bind_printers_for_bridge(p_bridge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_p public.printers%ROWTYPE;
  v_win text;
  v_match jsonb;
  v_new text;
  v_updated int := 0;
  v_renamed int := 0;
  v_online_peers int;
  v_active_printers int;
  v_local_thermals int;
  v_sole_takeover boolean := false;
  v_actions jsonb := '[]'::jsonb;
  v_addr jsonb;
  v_prev_driver text;
  v_prev_port text;
  v_prev_device text;
  v_manual text;
  v_manual_bridge text;
  v_needs_choice boolean := false;
  v_stole_from_online boolean := false;
BEGIN
  SELECT * INTO v_b FROM public.print_bridges WHERE id = p_bridge_id AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BRIDGE_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0, 'renamed', 0, 'reason', 'NO_LOCAL_DEVICES');
  END IF;

  SELECT count(*) INTO v_online_peers
  FROM public.print_bridges b
  WHERE b.restaurant_id = v_b.restaurant_id
    AND b.is_active
    AND b.id <> p_bridge_id
    AND b.last_heartbeat_at IS NOT NULL
    AND b.last_heartbeat_at > now() - interval '45 seconds';

  SELECT count(*) INTO v_active_printers
  FROM public.printers
  WHERE restaurant_id = v_b.restaurant_id
    AND is_active
    AND connection = 'windows_spooler';

  SELECT count(*) INTO v_local_thermals
  FROM public.print_bridge_devices d
  WHERE d.bridge_id = p_bridge_id
    AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes'
    AND public.m6_device_looks_thermal(d.windows_name, d.driver_name, d.port_name);

  -- One restaurant printer + this PC sees a thermal → ownership follows hardware.
  v_sole_takeover := (v_active_printers = 1 AND v_local_thermals >= 1);

  FOR v_p IN
    SELECT * FROM public.printers
    WHERE restaurant_id = v_b.restaurant_id
      AND is_active
      AND connection = 'windows_spooler'
  LOOP
    IF NOT (
      v_p.bridge_id IS NULL
      OR v_p.bridge_id = p_bridge_id
      OR NOT public.m6_bridge_is_online(v_p.bridge_id)
      OR v_online_peers = 0
      OR v_sole_takeover
    ) THEN
      CONTINUE;
    END IF;

    IF v_sole_takeover
       AND v_p.bridge_id IS NOT NULL
       AND v_p.bridge_id IS DISTINCT FROM p_bridge_id
       AND public.m6_bridge_is_online(v_p.bridge_id)
    THEN
      v_stole_from_online := true;
    END IF;

    v_win := nullif(trim(coalesce(v_p.address->>'windows_printer_name', '')), '');
    v_prev_driver := nullif(trim(coalesce(
      v_p.address->'bind_fingerprint'->>'driver_name',
      v_p.address->>'driver_name', '')), '');
    v_prev_port := nullif(trim(coalesce(
      v_p.address->'bind_fingerprint'->>'port_name',
      v_p.address->>'port_name', '')), '');
    v_prev_device := nullif(trim(coalesce(
      v_p.address->'bind_fingerprint'->>'device_id',
      v_p.address->>'device_id', '')), '');

    -- Manual choice valid only for same Bridge (device). Clear if device changed.
    v_manual := nullif(trim(coalesce(v_p.address->'cashier_choice'->>'windows_name', '')), '');
    v_manual_bridge := nullif(trim(coalesce(v_p.address->'cashier_choice'->>'bridge_id', '')), '');
    IF v_manual IS NOT NULL AND v_manual_bridge IS DISTINCT FROM p_bridge_id::text THEN
      v_manual := NULL;
    END IF;

    v_match := public.m6_match_windows_printer(
      p_bridge_id, v_win, v_prev_driver, v_prev_port, v_prev_device, v_manual);

    IF coalesce((v_match->>'needs_choice')::boolean, false) THEN
      v_needs_choice := true;
      IF v_p.bridge_id IS DISTINCT FROM p_bridge_id THEN
        UPDATE public.printers
        SET bridge_id = p_bridge_id, updated_at = now()
        WHERE id = v_p.id;
        IF FOUND THEN v_updated := v_updated + 1; END IF;
      END IF;
      v_actions := v_actions || jsonb_build_array(jsonb_build_object(
        'printer_id', v_p.id,
        'printer_name', v_p.name,
        'role', v_p.role,
        'from', v_win,
        'to', NULL,
        'reason', 'needs_choice',
        'detail', v_match->>'detail',
        'auto', false,
        'needs_choice', true,
        'candidates', coalesce(v_match->'candidates', '[]'::jsonb)
      ));
      CONTINUE;
    END IF;

    v_new := v_match->>'windows_name';
    IF v_new IS NULL THEN CONTINUE; END IF;

    IF v_win IS NOT NULL AND v_win = v_new AND v_p.bridge_id = p_bridge_id THEN
      v_addr := coalesce(v_p.address, '{}'::jsonb);
      v_addr := jsonb_set(v_addr, '{bind_fingerprint}', jsonb_build_object(
        'driver_name', v_match->>'driver_name',
        'port_name', v_match->>'port_name',
        'device_id', v_match->>'device_id',
        'normalized_name', public.m6_normalize_printer_name(v_new),
        'matched_at', now()
      ), true);
      UPDATE public.printers SET address = v_addr, updated_at = now()
      WHERE id = v_p.id
        AND coalesce(address->'bind_fingerprint', '{}'::jsonb)
           IS DISTINCT FROM (v_addr->'bind_fingerprint');
      CONTINUE;
    END IF;

    IF v_win IS NULL OR v_win <> v_new OR v_p.bridge_id IS DISTINCT FROM p_bridge_id THEN
      v_addr := coalesce(v_p.address, '{}'::jsonb);
      v_addr := jsonb_set(v_addr, '{windows_printer_name}', to_jsonb(v_new), true);
      v_addr := jsonb_set(v_addr, '{bind_fingerprint}', jsonb_build_object(
        'driver_name', v_match->>'driver_name',
        'port_name', v_match->>'port_name',
        'device_id', v_match->>'device_id',
        'normalized_name', public.m6_normalize_printer_name(v_new),
        'matched_at', now()
      ), true);
      IF v_win IS NOT NULL AND v_win <> v_new THEN
        v_addr := jsonb_set(v_addr, '{last_remap}', jsonb_build_object(
          'from', v_win,
          'to', v_new,
          'reason', v_match->>'reason',
          'detail', public.m6_printer_reason_ar(v_match->>'reason', v_win, v_new),
          'at', now()
        ), true);
      END IF;

      UPDATE public.printers
      SET bridge_id = p_bridge_id,
          address = v_addr,
          updated_at = now()
      WHERE id = v_p.id;

      IF FOUND THEN
        v_updated := v_updated + 1;
        IF v_win IS NULL OR v_win <> v_new THEN
          v_renamed := v_renamed + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object(
            'printer_id', v_p.id,
            'printer_name', v_p.name,
            'role', v_p.role,
            'from', v_win,
            'to', v_new,
            'reason', CASE WHEN v_sole_takeover THEN 'sole_printer_takeover' ELSE v_match->>'reason' END,
            'detail', CASE
              WHEN v_sole_takeover THEN
                'تم نقل ملكية الطابعة لهذا الجهاز لأنها الطابعة الوحيدة في المطعم.'
              ELSE public.m6_printer_reason_ar(v_match->>'reason', v_win, v_new)
            END,
            'auto', true
          ));
        ELSIF v_sole_takeover THEN
          v_actions := v_actions || jsonb_build_array(jsonb_build_object(
            'printer_id', v_p.id,
            'printer_name', v_p.name,
            'role', v_p.role,
            'from', v_win,
            'to', v_new,
            'reason', 'sole_printer_takeover',
            'detail', 'تم نقل ملكية الطابعة لهذا الجهاز لأنها الطابعة الوحيدة في المطعم.',
            'auto', true
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.print_jobs j
  SET bridge_id = p.bridge_id,
      status = CASE WHEN j.status = 'claimed' THEN 'pending' ELSE j.status END,
      claimed_by = CASE WHEN j.status = 'claimed' THEN NULL ELSE j.claimed_by END,
      claimed_at = CASE WHEN j.status = 'claimed' THEN NULL ELSE j.claimed_at END,
      payload = CASE
        WHEN nullif(trim(coalesce(p.address->>'windows_printer_name', '')), '') IS NULL THEN j.payload
        ELSE jsonb_set(
          coalesce(j.payload, '{}'::jsonb),
          '{windows_printer_name}',
          to_jsonb(p.address->>'windows_printer_name'),
          true
        )
      END,
      updated_at = now()
  FROM public.printers p
  WHERE j.printer_id = p.id
    AND p.bridge_id = p_bridge_id
    AND j.restaurant_id = v_b.restaurant_id
    AND j.status IN ('pending', 'retry_wait', 'claimed')
    AND (j.expires_at IS NULL OR j.expires_at > now())
    AND (
      j.bridge_id IS DISTINCT FROM p.bridge_id
      OR j.status = 'claimed'
      OR coalesce(j.payload->>'windows_printer_name', '')
           IS DISTINCT FROM coalesce(p.address->>'windows_printer_name', '')
    );

  -- Sole thermal restaurant: retire other online Bridges so claim cannot stick
  -- on the previous PC after the printer moved here.
  IF v_sole_takeover AND (v_stole_from_online OR v_online_peers > 0 OR v_updated > 0) THEN
    PERFORM public.m6_transfer_restaurant_print_ownership(p_bridge_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bridge_id', p_bridge_id,
    'updated', v_updated,
    'renamed', v_renamed,
    'needs_choice', v_needs_choice,
    'sole_takeover', v_sole_takeover,
    'picked_windows_name', public.m6_pick_bridge_windows_printer(p_bridge_id),
    'actions', v_actions
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
