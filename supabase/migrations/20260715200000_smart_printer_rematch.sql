-- Smart Windows printer rematch (driver/port/device_id + sole-thermal rule).
-- Never keep a stale queue name that is absent from the online Bridge inventory.

-- ---------------------------------------------------------------------------
-- Schema: enriched inventory
-- ---------------------------------------------------------------------------
ALTER TABLE public.print_bridge_devices
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS port_name text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.print_bridge_devices.driver_name IS 'Win32_Printer.DriverName';
COMMENT ON COLUMN public.print_bridge_devices.port_name IS 'Win32_Printer.PortName';
COMMENT ON COLUMN public.print_bridge_devices.device_id IS 'Win32_Printer.DeviceID';

-- ---------------------------------------------------------------------------
-- Name helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_normalize_printer_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(regexp_replace(
    regexp_replace(
      regexp_replace(coalesce(p_name, ''), '\s*\(copy\s*\d+\)\s*', ' ', 'gi'),
      '\s+usb\s*$', '', 'i'),
    '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.m6_printer_base_model(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    public.m6_normalize_printer_name(p_name),
    '([0-9])[a-z]$',
    '\1');
$$;

CREATE OR REPLACE FUNCTION public.m6_device_looks_thermal(
  p_windows_name text,
  p_driver_name text DEFAULT NULL,
  p_port_name text DEFAULT NULL
)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    coalesce(p_windows_name, '') ILIKE 'XP-%'
    OR coalesce(p_windows_name, '') ILIKE '%thermal%'
    OR coalesce(p_windows_name, '') ILIKE '%POS%'
    OR coalesce(p_windows_name, '') ILIKE '%receipt%'
    OR coalesce(p_windows_name, '') ILIKE '%escpos%'
    OR coalesce(p_driver_name, '') ILIKE '%thermal%'
    OR coalesce(p_driver_name, '') ILIKE '%POS%'
    OR coalesce(p_driver_name, '') ILIKE '%receipt%'
    OR coalesce(p_driver_name, '') ILIKE '%XP-%'
    OR coalesce(p_driver_name, '') ILIKE '%EPSON TM%'
    OR (
      coalesce(p_port_name, '') ILIKE 'USB%'
      AND coalesce(p_windows_name, '') !~* '(pdf|xps|onenote|fax|document writer)'
    );
$$;

-- ---------------------------------------------------------------------------
-- Score one local device against a wanted Windows name + last fingerprint
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_score_printer_candidate(
  p_local_name text,
  p_local_driver text,
  p_local_port text,
  p_local_device_id text,
  p_local_is_default boolean,
  p_wanted_name text,
  p_prev_driver text,
  p_prev_port text,
  p_prev_device_id text
)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_score int := 0;
  v_want_n text := public.m6_normalize_printer_name(p_wanted_name);
  v_loc_n text := public.m6_normalize_printer_name(p_local_name);
  v_want_b text := public.m6_printer_base_model(p_wanted_name);
  v_loc_b text := public.m6_printer_base_model(p_local_name);
BEGIN
  IF nullif(trim(p_local_name), '') IS NULL THEN RETURN 0; END IF;

  IF p_wanted_name IS NOT NULL AND p_local_name = p_wanted_name THEN
    RETURN 100;
  END IF;
  IF v_want_n <> '' AND v_want_n = v_loc_n THEN
    v_score := v_score + 45;
  ELSIF v_want_b <> '' AND v_want_b = v_loc_b THEN
    v_score := v_score + 30;
  ELSIF v_want_n <> '' AND (v_loc_n LIKE v_want_n || '%' OR v_want_n LIKE v_loc_n || '%') THEN
    v_score := v_score + 18;
  END IF;

  IF nullif(trim(coalesce(p_prev_device_id, '')), '') IS NOT NULL
     AND lower(trim(p_prev_device_id)) = lower(trim(coalesce(p_local_device_id, ''))) THEN
    v_score := v_score + 40;
  END IF;

  IF nullif(trim(coalesce(p_prev_driver, '')), '') IS NOT NULL
     AND lower(trim(p_prev_driver)) = lower(trim(coalesce(p_local_driver, ''))) THEN
    v_score := v_score + 28;
  END IF;

  IF nullif(trim(coalesce(p_prev_port, '')), '') IS NOT NULL
     AND lower(trim(p_prev_port)) = lower(trim(coalesce(p_local_port, ''))) THEN
    v_score := v_score + 22;
  END IF;

  IF coalesce(p_local_is_default, false) THEN
    v_score := v_score + 5;
  END IF;

  IF public.m6_device_looks_thermal(p_local_name, p_local_driver, p_local_port) THEN
    v_score := v_score + 8;
  END IF;

  RETURN least(v_score, 99);
END;
$$;

-- Best match for a printer binding against a bridge inventory.
-- Returns jsonb: { windows_name, score, reason, driver_name, port_name, device_id, auto }
CREATE OR REPLACE FUNCTION public.m6_match_windows_printer(
  p_bridge_id uuid,
  p_wanted_name text DEFAULT NULL,
  p_prev_driver text DEFAULT NULL,
  p_prev_port text DEFAULT NULL,
  p_prev_device_id text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev record;
  v_score int;
  v_best_score int := -1;
  v_best_name text;
  v_best_driver text;
  v_best_port text;
  v_best_device text;
  v_thermals int := 0;
  v_physical int := 0;
  v_sole_name text;
  v_sole_driver text;
  v_sole_port text;
  v_sole_device text;
  v_reason text;
  v_auto boolean := false;
BEGIN
  SELECT count(*) FILTER (WHERE NOT d.is_virtual),
         count(*) FILTER (WHERE NOT d.is_virtual
           AND public.m6_device_looks_thermal(d.windows_name, d.driver_name, d.port_name))
    INTO v_physical, v_thermals
  FROM public.print_bridge_devices d
  WHERE d.bridge_id = p_bridge_id
    AND d.last_seen_at > now() - interval '15 minutes';

  -- Sole thermal on this PC → always that printer (cashier experience).
  IF v_thermals = 1 THEN
    SELECT d.windows_name, d.driver_name, d.port_name, d.device_id
      INTO v_sole_name, v_sole_driver, v_sole_port, v_sole_device
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id
      AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
      AND public.m6_device_looks_thermal(d.windows_name, d.driver_name, d.port_name)
    LIMIT 1;

    IF v_sole_name IS NOT NULL THEN
      RETURN jsonb_build_object(
        'windows_name', v_sole_name,
        'score', 100,
        'reason', 'sole_thermal',
        'driver_name', v_sole_driver,
        'port_name', v_sole_port,
        'device_id', v_sole_device,
        'auto', true,
        'detail', format('طابعة حرارية وحيدة على الجهاز: %s', v_sole_name)
      );
    END IF;
  END IF;

  -- Exact name still present
  IF nullif(trim(coalesce(p_wanted_name, '')), '') IS NOT NULL THEN
    SELECT d.windows_name, d.driver_name, d.port_name, d.device_id
      INTO v_sole_name, v_sole_driver, v_sole_port, v_sole_device
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id
      AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
      AND d.windows_name = p_wanted_name
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'windows_name', v_sole_name,
        'score', 100,
        'reason', 'exact_name',
        'driver_name', v_sole_driver,
        'port_name', v_sole_port,
        'device_id', v_sole_device,
        'auto', true,
        'detail', v_sole_name
      );
    END IF;
  END IF;

  FOR v_dev IN
    SELECT d.windows_name, d.driver_name, d.port_name, d.device_id, d.is_default
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id
      AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
  LOOP
    v_score := public.m6_score_printer_candidate(
      v_dev.windows_name, v_dev.driver_name, v_dev.port_name, v_dev.device_id,
      v_dev.is_default, p_wanted_name, p_prev_driver, p_prev_port, p_prev_device_id);
    IF v_score > v_best_score THEN
      v_best_score := v_score;
      v_best_name := v_dev.windows_name;
      v_best_driver := v_dev.driver_name;
      v_best_port := v_dev.port_name;
      v_best_device := v_dev.device_id;
    END IF;
  END LOOP;

  IF v_best_score < 0 OR v_best_name IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_best_score >= 70 THEN
    v_reason := 'confident_match';
    v_auto := true;
  ELSIF v_physical = 1 THEN
    v_reason := 'sole_physical';
    v_auto := true;
    v_best_score := greatest(v_best_score, 80);
  ELSIF v_best_score >= 40 THEN
    v_reason := 'best_effort';
    v_auto := true;
  ELSE
    v_reason := 'discovered_fallback';
    v_auto := true;
  END IF;

  RETURN jsonb_build_object(
    'windows_name', v_best_name,
    'score', v_best_score,
    'reason', v_reason,
    'driver_name', v_best_driver,
    'port_name', v_best_port,
    'device_id', v_best_device,
    'auto', v_auto,
    'detail', format(
      'وجدنا طابعة مختلفة. %s وسيتم استخدامها بدلاً من %s',
      v_best_name,
      coalesce(nullif(trim(p_wanted_name), ''), '—')
    )
  );
END;
$$;

-- Prefer sole thermal, else XP/thermal/POS heuristic.
CREATE OR REPLACE FUNCTION public.m6_pick_bridge_windows_printer(p_bridge_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match jsonb;
BEGIN
  v_match := public.m6_match_windows_printer(p_bridge_id, NULL, NULL, NULL, NULL);
  RETURN v_match->>'windows_name';
END;
$$;

-- ---------------------------------------------------------------------------
-- Auto-bind with smart rematch + fingerprint persist
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
  v_actions jsonb := '[]'::jsonb;
  v_addr jsonb;
  v_prev_driver text;
  v_prev_port text;
  v_prev_device text;
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
    ) THEN
      CONTINUE;
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

    v_match := public.m6_match_windows_printer(
      p_bridge_id, v_win, v_prev_driver, v_prev_port, v_prev_device);

    IF v_match IS NULL THEN
      CONTINUE;
    END IF;

    v_new := v_match->>'windows_name';
    IF v_new IS NULL THEN CONTINUE; END IF;

    -- Exact still present and already ours → only refresh fingerprint if needed
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

    -- Remap when name missing / changed
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
          'score', (v_match->>'score')::int,
          'detail', v_match->>'detail',
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
            'reason', v_match->>'reason',
            'score', (v_match->>'score')::int,
            'detail', v_match->>'detail',
            'auto', coalesce((v_match->>'auto')::boolean, true)
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.print_jobs j
  SET bridge_id = p.bridge_id,
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
    AND j.status IN ('pending', 'retry_wait')
    AND (j.expires_at IS NULL OR j.expires_at > now())
    AND (
      j.bridge_id IS DISTINCT FROM p.bridge_id
      OR coalesce(j.payload->>'windows_printer_name', '')
           IS DISTINCT FROM coalesce(p.address->>'windows_printer_name', '')
    );

  RETURN jsonb_build_object(
    'ok', true,
    'bridge_id', p_bridge_id,
    'updated', v_updated,
    'renamed', v_renamed,
    'picked_windows_name', public.m6_pick_bridge_windows_printer(p_bridge_id),
    'actions', v_actions
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- report_bridge_printers: enriched inventory + auto-bind
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_bridge_printers(
  p_token text,
  p_printers jsonb DEFAULT '[]'::jsonb
)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_item jsonb;
  v_name text;
  v_virtual boolean;
  v_count int := 0;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  v_b := public.m6_require_bridge_token(p_token);

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_printers, '[]'::jsonb))
  LOOP
    v_name := nullif(trim(coalesce(v_item->>'name', '')), '');
    IF v_name IS NULL THEN CONTINUE; END IF;
    v_virtual := coalesce((v_item->>'is_virtual')::boolean, false);

    INSERT INTO public.print_bridge_devices (
      restaurant_id, bridge_id, windows_name, is_virtual,
      driver_name, port_name, device_id, is_default, last_seen_at
    ) VALUES (
      v_b.restaurant_id, v_b.id, v_name, v_virtual,
      nullif(trim(coalesce(v_item->>'driver_name', '')), ''),
      nullif(trim(coalesce(v_item->>'port_name', '')), ''),
      nullif(trim(coalesce(v_item->>'device_id', '')), ''),
      coalesce((v_item->>'is_default')::boolean, false),
      now()
    )
    ON CONFLICT (bridge_id, windows_name) DO UPDATE SET
      is_virtual = excluded.is_virtual,
      driver_name = coalesce(excluded.driver_name, public.print_bridge_devices.driver_name),
      port_name = coalesce(excluded.port_name, public.print_bridge_devices.port_name),
      device_id = coalesce(excluded.device_id, public.print_bridge_devices.device_id),
      is_default = excluded.is_default,
      last_seen_at = now();

    v_seen := array_append(v_seen, v_name);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.print_bridge_devices
  WHERE bridge_id = v_b.id
    AND NOT (windows_name = ANY (v_seen));

  PERFORM public.m6_auto_bind_printers_for_bridge(v_b.id);
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_bridge_printers(text, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- list_print_bridges: include driver/port
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_print_bridges()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY online DESC, last_heartbeat_at DESC NULLS LAST)
    FROM (
      SELECT jsonb_build_object(
        'id', b.id,
        'display_name', b.display_name,
        'device_name', b.device_name,
        'windows_username', b.windows_username,
        'version', b.version,
        'last_heartbeat_at', b.last_heartbeat_at,
        'online', (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '45 seconds'),
        'is_active', b.is_active,
        'devices', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'windows_name', d.windows_name,
            'is_virtual', d.is_virtual,
            'driver_name', d.driver_name,
            'port_name', d.port_name,
            'device_id', d.device_id,
            'is_default', d.is_default,
            'last_seen_at', d.last_seen_at,
            'assigned_printer_id', (
              SELECT p.id FROM public.printers p
              WHERE p.restaurant_id = v_rest
                AND p.bridge_id = b.id
                AND p.address->>'windows_printer_name' = d.windows_name
              LIMIT 1
            )
          ) ORDER BY d.is_virtual, d.windows_name)
          FROM public.print_bridge_devices d
          WHERE d.bridge_id = b.id
            AND d.last_seen_at > now() - interval '15 minutes'
        ), '[]'::jsonb)
      ) AS row,
      (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '45 seconds') AS online,
      b.last_heartbeat_at
      FROM public.print_bridges b
      WHERE b.restaurant_id = v_rest AND b.is_active
    ) s
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- diagnose: explain remaps clearly (not just name mismatch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnose_print_system()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_online public.print_bridges%ROWTYPE;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_ok boolean;
  v_cashier public.printers%ROWTYPE;
  v_kitchen public.printers%ROWTYPE;
  v_devices int;
  v_pending int;
  v_win text;
  v_match jsonb;
  v_reject jsonb;
  v_remaps jsonb := '[]'::jsonb;
  v_p public.printers%ROWTYPE;
  v_last jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'supabase', 'ok', true,
    'label', 'متصل بـ Supabase', 'detail', v_rest::text
  ));

  SELECT * INTO v_online FROM public.print_bridges
  WHERE restaurant_id = v_rest AND is_active
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at > now() - interval '45 seconds'
  ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;

  v_ok := FOUND;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'heartbeat', 'ok', v_ok,
    'label', 'Heartbeat',
    'detail', CASE WHEN v_ok THEN
      format('%s · %s · منذ %s ث',
        coalesce(v_online.device_name, v_online.display_name),
        coalesce(v_online.version, '?'),
        greatest(0, trunc(extract(epoch from (now() - v_online.last_heartbeat_at))))::text)
      ELSE 'لا يوجد Bridge متصل خلال 45 ثانية' END
  ));

  v_ok := v_online.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'poll', 'ok', v_ok,
    'label', 'Poll يعمل (جسر متصل قابل للالتقاط)',
    'detail', CASE WHEN v_ok THEN v_online.id::text ELSE 'لا يمكن الالتقاط بدون جسر متصل' END
  ));

  SELECT count(*) INTO v_devices FROM public.print_bridge_devices d
  WHERE d.bridge_id = v_online.id AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes';
  v_ok := v_online.id IS NOT NULL AND v_devices > 0;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'printer_exists', 'ok', v_ok,
    'label', 'الطابعة موجودة (مخزون Windows)',
    'detail', CASE WHEN v_ok THEN format('%s طابعة محلية', v_devices)
      ELSE 'الجسر لم يبلّغ عن طابعات Windows غير افتراضية' END
  ));

  SELECT * INTO v_cashier FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'cashier' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  SELECT * INTO v_kitchen FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'kitchen' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  v_ok := v_cashier.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'default_printer', 'ok', v_ok,
    'label', 'الطابعة الافتراضية (كاشير)',
    'detail', CASE WHEN v_ok THEN v_cashier.name ELSE 'لا توجد طابعة كاشير نشطة' END
  ));

  v_ok := v_online.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'device_id', 'ok', v_ok,
    'label', 'Device / Bridge ID',
    'detail', CASE WHEN v_ok THEN
      format('bridge=%s · device=%s', v_online.id, coalesce(v_online.device_name, '—'))
      ELSE '—' END
  ));

  v_ok := v_online.version IS NOT NULL AND v_online.version >= '0.4.0';
  IF v_online.id IS NOT NULL AND NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'bridge_version', 'ok', coalesce(v_ok, false),
    'label', 'إصدار Bridge (المطابقة الذكية)',
    'detail', coalesce(v_online.version, 'غير معروف') || ' · المطلوب ≥ 0.4.0'
  ));

  -- Name / smart remap status for cashier
  IF v_online.id IS NOT NULL AND v_cashier.id IS NOT NULL THEN
    v_win := nullif(trim(coalesce(v_cashier.address->>'windows_printer_name', '')), '');
    v_match := public.m6_match_windows_printer(
      v_online.id,
      v_win,
      v_cashier.address->'bind_fingerprint'->>'driver_name',
      v_cashier.address->'bind_fingerprint'->>'port_name',
      v_cashier.address->'bind_fingerprint'->>'device_id'
    );
    v_last := v_cashier.address->'last_remap';

    IF v_win IS NOT NULL AND v_match->>'windows_name' = v_win THEN
      v_ok := true;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'id', 'name_match', 'ok', true,
        'label', 'ربط الطابعة بالجهاز المتصل',
        'detail', format('%s · السبب=%s', v_win, coalesce(v_match->>'reason', 'exact'))
      ));
    ELSIF v_match IS NOT NULL THEN
      -- Bound name differs — auto-remap already applies on heartbeat; report clearly.
      v_ok := coalesce((v_match->>'auto')::boolean, true);
      IF NOT v_ok THEN v_ready := false; END IF;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'id', 'name_match',
        'ok', v_ok,
        'label', 'وجدنا طابعة مختلفة — سيتم استخدامها تلقائيًا',
        'detail', format(
          'الجديدة: %s · بدلاً من: %s · السبب: %s · الدرجة: %s',
          v_match->>'windows_name',
          coalesce(v_win, '—'),
          coalesce(v_match->>'reason', '—'),
          coalesce(v_match->>'score', '0')
        ),
        'from_name', v_win,
        'to_name', v_match->>'windows_name',
        'reason', v_match->>'reason',
        'score', (v_match->>'score')::int,
        'can_apply', true
      ));
      v_remaps := v_remaps || jsonb_build_array(jsonb_build_object(
        'printer_id', v_cashier.id,
        'printer_name', v_cashier.name,
        'role', 'cashier',
        'from', v_win,
        'to', v_match->>'windows_name',
        'reason', v_match->>'reason',
        'score', (v_match->>'score')::int,
        'detail', v_match->>'detail',
        'applied', coalesce(v_last->>'to', '') = coalesce(v_match->>'windows_name', '')
      ));
    ELSE
      v_ready := false;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'id', 'name_match', 'ok', false,
        'label', 'ربط الطابعة بالجهاز المتصل',
        'detail', 'لا توجد طابعة محلية صالحة للمطابقة'
      ));
    END IF;
  ELSE
    v_ready := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match', 'ok', false,
      'label', 'ربط الطابعة بالجهاز المتصل',
      'detail', 'تعذّر الفحص'
    ));
  END IF;

  -- Collect recent remaps / pending proposals for all printers
  FOR v_p IN
    SELECT * FROM public.printers
    WHERE restaurant_id = v_rest AND is_active AND connection = 'windows_spooler'
  LOOP
    IF v_p.address ? 'last_remap' THEN
      v_remaps := v_remaps || jsonb_build_array(jsonb_build_object(
        'printer_id', v_p.id,
        'printer_name', v_p.name,
        'role', v_p.role,
        'from', v_p.address->'last_remap'->>'from',
        'to', v_p.address->'last_remap'->>'to',
        'reason', v_p.address->'last_remap'->>'reason',
        'score', v_p.address->'last_remap'->>'score',
        'detail', v_p.address->'last_remap'->>'detail',
        'applied', true,
        'at', v_p.address->'last_remap'->>'at'
      ));
    END IF;
  END LOOP;

  SELECT count(*) INTO v_pending FROM public.print_jobs
  WHERE restaurant_id = v_rest AND status IN ('pending', 'retry_wait', 'claimed', 'printing');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'reference', j.reference,
    'status', j.status,
    'attempt_count', j.attempt_count,
    'job_bridge_id', j.bridge_id,
    'printer_id', j.printer_id,
    'printer_bridge_id', p.bridge_id,
    'windows_printer_name', p.address->>'windows_printer_name',
    'reject_reason', CASE
      WHEN v_online.id IS NULL THEN 'NO_ONLINE_BRIDGE'
      WHEN j.expires_at IS NOT NULL AND j.expires_at <= now() THEN 'EXPIRED'
      WHEN j.bridge_id IS NOT NULL AND j.bridge_id <> v_online.id
        AND public.m6_bridge_is_online(j.bridge_id)
        THEN 'JOB_ROUTED_TO_OTHER_ONLINE_BRIDGE'
      WHEN j.status = 'retry_wait' AND coalesce(j.next_attempt_at, now()) > now()
        THEN 'RETRY_WAIT'
      ELSE 'CLAIMABLE_BY_ONLINE_BRIDGE'
    END
  ) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_reject
  FROM public.print_jobs j
  LEFT JOIN public.printers p ON p.id = j.printer_id
  WHERE j.restaurant_id = v_rest
    AND j.status IN ('pending', 'retry_wait', 'claimed', 'printing');

  v_ok := v_online.id IS NOT NULL;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'queue', 'ok', v_ok,
    'label', 'قائمة الطباعة / قابلية الالتقاط',
    'detail', format('مهام نشطة: %s', v_pending)
  ));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'test_ready', 'ok', v_ready,
    'label', 'جاهزية اختبار الطباعة',
    'detail', CASE WHEN v_ready THEN 'يمكن تشغيل صفحة اختبار من هذا التبويب'
      ELSE 'أصلِح العناصر الحمراء أولًا' END
  ));

  RETURN jsonb_build_object(
    'ready', v_ready,
    'checked_at', now(),
    'online_bridge', CASE WHEN v_online.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_online.id,
      'device_name', v_online.device_name,
      'display_name', v_online.display_name,
      'version', v_online.version,
      'last_heartbeat_at', v_online.last_heartbeat_at,
      'windows_username', v_online.windows_username
    ) END,
    'checks', v_checks,
    'remaps', v_remaps,
    'pending_jobs', v_reject,
    'printers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'role', p.role,
        'bridge_id', p.bridge_id,
        'windows_printer_name', p.address->>'windows_printer_name',
        'driver_name', p.address->'bind_fingerprint'->>'driver_name',
        'port_name', p.address->'bind_fingerprint'->>'port_name',
        'last_remap', p.address->'last_remap',
        'bridge_online', public.m6_bridge_is_online(p.bridge_id)
      ) ORDER BY p.sort_order, p.name)
      FROM public.printers p
      WHERE p.restaurant_id = v_rest AND p.is_active
    ), '[]'::jsonb),
    'bridges', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'device_name', b.device_name,
        'is_active', b.is_active,
        'online', public.m6_bridge_is_online(b.id),
        'version', b.version,
        'last_heartbeat_at', b.last_heartbeat_at,
        'device_count', (
          SELECT count(*) FROM public.print_bridge_devices d
          WHERE d.bridge_id = b.id AND d.is_virtual = false
            AND d.last_seen_at > now() - interval '15 minutes'
        )
      ) ORDER BY b.last_heartbeat_at DESC NULLS LAST)
      FROM public.print_bridges b
      WHERE b.restaurant_id = v_rest
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_print_system() TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_auto_bind_printers_for_bridge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_match_windows_printer(uuid, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
