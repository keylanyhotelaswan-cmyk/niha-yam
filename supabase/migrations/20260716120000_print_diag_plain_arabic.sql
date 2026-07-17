-- Plain-Arabic print diagnostics + multi-thermal cashier choice (no guessing).

DROP FUNCTION IF EXISTS public.m6_match_windows_printer(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.m6_match_windows_printer(uuid, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- Arabic reason helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_printer_reason_ar(
  p_reason text,
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE coalesce(p_reason, '')
    WHEN 'sole_thermal' THEN
      'تم العثور على طابعة حرارية واحدة، لذلك تم اختيارها تلقائيًا.'
    WHEN 'sole_physical' THEN
      'تم العثور على طابعة واحدة فقط على هذا الجهاز، لذلك تم اختيارها تلقائيًا.'
    WHEN 'exact_name' THEN
      'تم العثور على نفس الطابعة المسجلة.'
    WHEN 'user_choice' THEN
      'تم استخدام اختيارك السابق.'
    WHEN 'confident_match' THEN
      CASE WHEN nullif(trim(coalesce(p_from, '')), '') IS NOT NULL
            AND nullif(trim(coalesce(p_to, '')), '') IS NOT NULL
            AND p_from IS DISTINCT FROM p_to
        THEN 'تم تغيير اسم الطابعة في ويندوز، وتم تصحيح الربط تلقائيًا.'
        ELSE 'تم العثور على طابعة بنفس النوع، وتم تحديث الربط تلقائيًا.'
      END
    WHEN 'best_effort' THEN
      'تم العثور على طابعة جديدة على هذا الجهاز، وتم تحديث الربط تلقائيًا.'
    WHEN 'discovered_fallback' THEN
      'تم العثور على طابعة جديدة على هذا الجهاز، وتم تحديث الربط تلقائيًا.'
    WHEN 'needs_choice' THEN
      'يوجد أكثر من طابعة حرارية على هذا الجهاز. اختر الطابعة التي تريد استخدامها للكاشير.'
    WHEN 'no_printer' THEN
      'لا توجد طابعة صالحة على هذا الجهاز حاليًا.'
    WHEN 'bridge_offline' THEN
      'برنامج الطباعة غير متصل الآن.'
    ELSE
      'تم اختيار الطابعة المتصلة بهذا الجهاز.'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Match: honor manual choice; ask when multiple thermals & no confident match
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_match_windows_printer(
  p_bridge_id uuid,
  p_wanted_name text DEFAULT NULL,
  p_prev_driver text DEFAULT NULL,
  p_prev_port text DEFAULT NULL,
  p_prev_device_id text DEFAULT NULL,
  p_manual_name text DEFAULT NULL
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
  v_candidates jsonb := '[]'::jsonb;
  v_manual text := nullif(trim(coalesce(p_manual_name, '')), '');
BEGIN
  SELECT count(*) FILTER (WHERE NOT d.is_virtual),
         count(*) FILTER (WHERE NOT d.is_virtual
           AND public.m6_device_looks_thermal(d.windows_name, d.driver_name, d.port_name))
    INTO v_physical, v_thermals
  FROM public.print_bridge_devices d
  WHERE d.bridge_id = p_bridge_id
    AND d.last_seen_at > now() - interval '15 minutes';

  IF v_physical = 0 THEN
    RETURN jsonb_build_object(
      'windows_name', NULL,
      'score', 0,
      'reason', 'no_printer',
      'auto', false,
      'needs_choice', false,
      'candidates', '[]'::jsonb,
      'detail', public.m6_printer_reason_ar('no_printer')
    );
  END IF;

  -- Manual cashier choice still present on this device
  IF v_manual IS NOT NULL THEN
    SELECT d.windows_name, d.driver_name, d.port_name, d.device_id
      INTO v_sole_name, v_sole_driver, v_sole_port, v_sole_device
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id
      AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
      AND d.windows_name = v_manual
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'windows_name', v_sole_name,
        'score', 100,
        'reason', 'user_choice',
        'driver_name', v_sole_driver,
        'port_name', v_sole_port,
        'device_id', v_sole_device,
        'auto', true,
        'needs_choice', false,
        'candidates', '[]'::jsonb,
        'detail', public.m6_printer_reason_ar('user_choice')
      );
    END IF;
  END IF;

  -- Sole thermal → auto
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
        'needs_choice', false,
        'candidates', '[]'::jsonb,
        'detail', public.m6_printer_reason_ar('sole_thermal')
      );
    END IF;
  END IF;

  -- Exact registered name still present
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
        'needs_choice', false,
        'candidates', '[]'::jsonb,
        'detail', public.m6_printer_reason_ar('exact_name')
      );
    END IF;
  END IF;

  -- Score candidates
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
    RETURN jsonb_build_object(
      'windows_name', NULL,
      'score', 0,
      'reason', 'no_printer',
      'auto', false,
      'needs_choice', false,
      'candidates', '[]'::jsonb,
      'detail', public.m6_printer_reason_ar('no_printer')
    );
  END IF;

  -- Confident / sole physical → auto
  IF v_best_score >= 70 THEN
    v_reason := 'confident_match';
    v_auto := true;
  ELSIF v_physical = 1 THEN
    v_reason := 'sole_physical';
    v_auto := true;
    v_best_score := greatest(v_best_score, 80);
  ELSIF v_thermals > 1 THEN
    -- Do NOT guess among multiple thermals
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'windows_name', d.windows_name,
      'is_default', d.is_default
    ) ORDER BY d.windows_name), '[]'::jsonb)
      INTO v_candidates
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = p_bridge_id
      AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes'
      AND public.m6_device_looks_thermal(d.windows_name, d.driver_name, d.port_name);

    RETURN jsonb_build_object(
      'windows_name', NULL,
      'score', v_best_score,
      'reason', 'needs_choice',
      'auto', false,
      'needs_choice', true,
      'candidates', v_candidates,
      'detail', public.m6_printer_reason_ar('needs_choice'),
      'from_name', p_wanted_name
    );
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
    'needs_choice', false,
    'candidates', '[]'::jsonb,
    'detail', public.m6_printer_reason_ar(v_reason, p_wanted_name, v_best_name),
    'from_name', p_wanted_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.m6_pick_bridge_windows_printer(p_bridge_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match jsonb;
BEGIN
  v_match := public.m6_match_windows_printer(p_bridge_id);
  IF coalesce((v_match->>'needs_choice')::boolean, false) THEN
    RETURN NULL;
  END IF;
  RETURN v_match->>'windows_name';
END;
$$;

-- ---------------------------------------------------------------------------
-- Auto-bind: skip rename when needs_choice; honor cashier_choice
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
  v_manual text;
  v_manual_bridge text;
  v_needs_choice boolean := false;
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
      -- Own the bridge but do not invent a Windows name
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
            'reason', v_match->>'reason',
            'detail', public.m6_printer_reason_ar(v_match->>'reason', v_win, v_new),
            'auto', true
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
    'needs_choice', v_needs_choice,
    'picked_windows_name', public.m6_pick_bridge_windows_printer(p_bridge_id),
    'actions', v_actions
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Save cashier Windows printer choice (multi-thermal)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.choose_cashier_windows_printer(p_windows_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_bridge public.print_bridges%ROWTYPE;
  v_cashier public.printers%ROWTYPE;
  v_name text := nullif(trim(coalesce(p_windows_name, '')), '');
  v_addr jsonb;
BEGIN
  IF v_rest IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'INVALID_PRINTER_NAME';
  END IF;

  SELECT * INTO v_bridge FROM public.print_bridges
  WHERE restaurant_id = v_rest AND is_active
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at > now() - interval '45 seconds'
  ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ONLINE_BRIDGE');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.print_bridge_devices d
    WHERE d.bridge_id = v_bridge.id
      AND d.is_virtual = false
      AND d.windows_name = v_name
      AND d.last_seen_at > now() - interval '15 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PRINTER_NOT_ON_DEVICE');
  END IF;

  SELECT * INTO v_cashier FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'cashier' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_CASHIER_PRINTER');
  END IF;

  v_addr := coalesce(v_cashier.address, '{}'::jsonb);
  v_addr := jsonb_set(v_addr, '{windows_printer_name}', to_jsonb(v_name), true);
  v_addr := jsonb_set(v_addr, '{cashier_choice}', jsonb_build_object(
    'windows_name', v_name,
    'bridge_id', v_bridge.id,
    'chosen_at', now()
  ), true);
  IF nullif(trim(coalesce(v_cashier.address->>'windows_printer_name', '')), '') IS DISTINCT FROM v_name THEN
    v_addr := jsonb_set(v_addr, '{last_remap}', jsonb_build_object(
      'from', v_cashier.address->>'windows_printer_name',
      'to', v_name,
      'reason', 'user_choice',
      'detail', public.m6_printer_reason_ar('user_choice'),
      'at', now()
    ), true);
  END IF;

  UPDATE public.printers
  SET bridge_id = v_bridge.id,
      address = v_addr,
      updated_at = now()
  WHERE id = v_cashier.id;

  UPDATE public.print_jobs j
  SET bridge_id = v_bridge.id,
      payload = jsonb_set(
        coalesce(j.payload, '{}'::jsonb),
        '{windows_printer_name}',
        to_jsonb(v_name),
        true
      ),
      updated_at = now()
  WHERE j.printer_id = v_cashier.id
    AND j.restaurant_id = v_rest
    AND j.status IN ('pending', 'retry_wait')
    AND (j.expires_at IS NULL OR j.expires_at > now());

  RETURN jsonb_build_object(
    'ok', true,
    'printer_id', v_cashier.id,
    'windows_name', v_name,
    'bridge_id', v_bridge.id,
    'reason_ar', public.m6_printer_reason_ar('user_choice')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.choose_cashier_windows_printer(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- diagnose_print_system: plain-Arabic selection story
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
  v_devices int;
  v_pending int;
  v_win text;
  v_match jsonb;
  v_reject jsonb;
  v_remaps jsonb := '[]'::jsonb;
  v_p public.printers%ROWTYPE;
  v_last jsonb;
  v_manual text;
  v_manual_bridge text;
  v_selection jsonb;
  v_status_ar text;
  v_active text;
  v_reason text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_online FROM public.print_bridges
  WHERE restaurant_id = v_rest AND is_active
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at > now() - interval '45 seconds'
  ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;

  v_ok := FOUND;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'heartbeat',
    'ok', v_ok,
    'label', 'برنامج الطباعة متصل',
    'detail', CASE WHEN v_ok THEN
      format('متصل · الإصدار %s', coalesce(v_online.version, '؟'))
      ELSE 'برنامج الطباعة غير متصل الآن' END
  ));

  SELECT count(*) INTO v_devices FROM public.print_bridge_devices d
  WHERE d.bridge_id = v_online.id AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes';
  v_ok := v_online.id IS NOT NULL AND v_devices > 0;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'printer_exists',
    'ok', v_ok,
    'label', 'الطابعة موجودة على الجهاز',
    'detail', CASE WHEN v_ok THEN format('عدد الطابعات على الجهاز: %s', v_devices)
      ELSE 'لم يتم العثور على طابعة على الجهاز المتصل' END
  ));

  SELECT * INTO v_cashier FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'cashier' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  v_ok := v_cashier.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'default_printer',
    'ok', v_ok,
    'label', 'طابعة الكاشير معرّفة',
    'detail', CASE WHEN v_ok THEN v_cashier.name ELSE 'لا توجد طابعة كاشير نشطة' END
  ));

  v_ok := v_online.version IS NOT NULL AND v_online.version >= '0.4.0';
  IF v_online.id IS NOT NULL AND NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'bridge_version',
    'ok', coalesce(v_ok, false),
    'label', 'إصدار برنامج الطباعة مناسب',
    'detail', CASE
      WHEN v_online.id IS NULL THEN 'غير معروف'
      WHEN coalesce(v_ok, false) THEN coalesce(v_online.version, '؟')
      ELSE format('الإصدار الحالي %s — حدّث برنامج الطباعة إلى 0.4.0 أو أحدث', coalesce(v_online.version, '؟'))
    END
  ));

  -- Selection story for cashier
  IF v_online.id IS NULL THEN
    v_selection := jsonb_build_object(
      'connected', false,
      'bridge_version', NULL,
      'active_printer', NULL,
      'reason_code', 'bridge_offline',
      'reason_ar', public.m6_printer_reason_ar('bridge_offline'),
      'status_message_ar', public.m6_printer_reason_ar('bridge_offline'),
      'last_remap_at', NULL,
      'needs_choice', false,
      'candidates', '[]'::jsonb
    );
    v_ready := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match', 'ok', false,
      'label', 'اختيار الطابعة',
      'detail', public.m6_printer_reason_ar('bridge_offline')
    ));
  ELSIF v_cashier.id IS NULL THEN
    v_selection := jsonb_build_object(
      'connected', true,
      'bridge_version', v_online.version,
      'active_printer', NULL,
      'reason_code', 'no_printer',
      'reason_ar', 'لا توجد طابعة كاشير معرّفة في النظام.',
      'status_message_ar', 'لا توجد طابعة كاشير معرّفة في النظام.',
      'last_remap_at', NULL,
      'needs_choice', false,
      'candidates', '[]'::jsonb
    );
    v_ready := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match', 'ok', false,
      'label', 'اختيار الطابعة',
      'detail', 'لا توجد طابعة كاشير معرّفة في النظام.'
    ));
  ELSE
    v_win := nullif(trim(coalesce(v_cashier.address->>'windows_printer_name', '')), '');
    v_manual := nullif(trim(coalesce(v_cashier.address->'cashier_choice'->>'windows_name', '')), '');
    v_manual_bridge := nullif(trim(coalesce(v_cashier.address->'cashier_choice'->>'bridge_id', '')), '');
    IF v_manual IS NOT NULL AND v_manual_bridge IS DISTINCT FROM v_online.id::text THEN
      v_manual := NULL;
    END IF;

    v_match := public.m6_match_windows_printer(
      v_online.id,
      v_win,
      v_cashier.address->'bind_fingerprint'->>'driver_name',
      v_cashier.address->'bind_fingerprint'->>'port_name',
      v_cashier.address->'bind_fingerprint'->>'device_id',
      v_manual
    );
    v_last := v_cashier.address->'last_remap';
    v_reason := coalesce(v_match->>'reason', 'exact_name');
    v_active := coalesce(
      nullif(trim(coalesce(v_match->>'windows_name', '')), ''),
      v_win
    );

    IF coalesce((v_match->>'needs_choice')::boolean, false) THEN
      v_ready := false;
      v_status_ar := public.m6_printer_reason_ar('needs_choice');
      v_ok := false;
    ELSIF v_active IS NULL THEN
      v_ready := false;
      v_status_ar := public.m6_printer_reason_ar('no_printer');
      v_ok := false;
    ELSIF v_win IS NOT NULL AND v_active IS DISTINCT FROM v_win THEN
      v_ok := true;
      v_status_ar := public.m6_printer_reason_ar(v_reason, v_win, v_active);
    ELSIF v_last IS NOT NULL AND coalesce(v_last->>'to', '') = coalesce(v_active, '') THEN
      v_ok := true;
      v_status_ar := coalesce(
        nullif(trim(coalesce(v_last->>'detail', '')), ''),
        public.m6_printer_reason_ar(coalesce(v_last->>'reason', v_reason), v_last->>'from', v_last->>'to')
      );
    ELSE
      v_ok := true;
      v_status_ar := public.m6_printer_reason_ar(v_reason, v_win, v_active);
    END IF;

    v_selection := jsonb_build_object(
      'connected', true,
      'bridge_version', v_online.version,
      'device_label', coalesce(v_online.display_name, v_online.device_name),
      'active_printer', v_active,
      'previous_printer', v_win,
      'reason_code', v_reason,
      'reason_ar', public.m6_printer_reason_ar(v_reason, v_win, v_active),
      'status_message_ar', v_status_ar,
      'last_remap_at', v_last->>'at',
      'last_remap_from', v_last->>'from',
      'last_remap_to', v_last->>'to',
      'needs_choice', coalesce((v_match->>'needs_choice')::boolean, false),
      'candidates', coalesce(v_match->'candidates', '[]'::jsonb),
      'auto_applied', coalesce((v_match->>'auto')::boolean, false)
        AND NOT coalesce((v_match->>'needs_choice')::boolean, false)
    );

    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match',
      'ok', v_ok,
      'label', CASE WHEN coalesce((v_match->>'needs_choice')::boolean, false)
        THEN 'اختيار طابعة الكاشير مطلوب'
        ELSE 'الطابعة جاهزة للطباعة' END,
      'detail', v_status_ar,
      'from_name', CASE WHEN v_win IS DISTINCT FROM v_active THEN v_win ELSE NULL END,
      'to_name', v_active,
      'reason', v_reason,
      'can_apply', coalesce((v_match->>'needs_choice')::boolean, false)
    ));

    IF coalesce((v_match->>'needs_choice')::boolean, false) THEN
      v_remaps := v_remaps || jsonb_build_array(jsonb_build_object(
        'printer_id', v_cashier.id,
        'printer_name', v_cashier.name,
        'role', 'cashier',
        'from', v_win,
        'to', NULL,
        'reason', 'needs_choice',
        'detail', v_status_ar,
        'applied', false,
        'needs_choice', true,
        'candidates', coalesce(v_match->'candidates', '[]'::jsonb)
      ));
    ELSIF v_last IS NOT NULL THEN
      v_remaps := v_remaps || jsonb_build_array(jsonb_build_object(
        'printer_id', v_cashier.id,
        'printer_name', v_cashier.name,
        'role', 'cashier',
        'from', v_last->>'from',
        'to', v_last->>'to',
        'reason', v_last->>'reason',
        'detail', coalesce(v_last->>'detail', v_status_ar),
        'applied', true,
        'at', v_last->>'at'
      ));
    END IF;
  END IF;

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

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'queue',
    'ok', v_online.id IS NOT NULL,
    'label', 'قائمة انتظار الطباعة',
    'detail', format('مهام بانتظار الطباعة: %s', v_pending)
  ));

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'test_ready',
    'ok', v_ready,
    'label', 'جاهزية الطباعة',
    'detail', CASE WHEN v_ready THEN 'يمكن إرسال اختبار طباعة الآن'
      ELSE 'راجع النقاط أعلاه قبل الاختبار' END
  ));

  RETURN jsonb_build_object(
    'ready', v_ready,
    'checked_at', now(),
    'selection', coalesce(v_selection, '{}'::jsonb),
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
GRANT EXECUTE ON FUNCTION public.m6_match_windows_printer(uuid, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
