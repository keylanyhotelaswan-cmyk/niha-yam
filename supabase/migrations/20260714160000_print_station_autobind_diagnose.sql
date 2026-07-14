-- Multi-PC print station registration + manager diagnostics.
-- Root cause for "Bridge connected but no print on second PC":
--   printers.bridge_id + windows_printer_name stay tied to another machine
--   (e.g. XP-80C on DESKTOP while online Bridge is PC with XP-80 only).
-- Fix: when a Bridge reports inventory / heartbeats, bind printers it can
-- own and remap windows_printer_name to a local discovered non-virtual name.

CREATE OR REPLACE FUNCTION public.m6_bridge_is_online(p_bridge_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.print_bridges b
    WHERE b.id = p_bridge_id
      AND b.is_active
      AND b.last_heartbeat_at IS NOT NULL
      AND b.last_heartbeat_at > now() - interval '45 seconds'
  );
$$;

CREATE OR REPLACE FUNCTION public.m6_pick_bridge_windows_printer(p_bridge_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
BEGIN
  SELECT d.windows_name INTO v_name
  FROM public.print_bridge_devices d
  WHERE d.bridge_id = p_bridge_id
    AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes'
  ORDER BY
    CASE
      WHEN d.windows_name ILIKE 'XP-%' THEN 0
      WHEN d.windows_name ILIKE '%thermal%' THEN 1
      WHEN d.windows_name ILIKE '%POS%' THEN 2
      ELSE 3
    END,
    d.last_seen_at DESC
  LIMIT 1;
  RETURN v_name;
END; $$;

CREATE OR REPLACE FUNCTION public.m6_auto_bind_printers_for_bridge(p_bridge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_local text[];
  v_pick text;
  v_p public.printers%ROWTYPE;
  v_win text;
  v_updated int := 0;
  v_names int := 0;
  v_online_peers int;
BEGIN
  SELECT * INTO v_b FROM public.print_bridges WHERE id = p_bridge_id AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BRIDGE_NOT_FOUND');
  END IF;

  SELECT coalesce(array_agg(d.windows_name), ARRAY[]::text[]) INTO v_local
  FROM public.print_bridge_devices d
  WHERE d.bridge_id = p_bridge_id
    AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes';

  IF coalesce(array_length(v_local, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0, 'renamed', 0, 'reason', 'NO_LOCAL_DEVICES');
  END IF;

  v_pick := public.m6_pick_bridge_windows_printer(p_bridge_id);

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
    -- Own if unbound, already ours, bound bridge offline, or we are sole online station
    IF NOT (
      v_p.bridge_id IS NULL
      OR v_p.bridge_id = p_bridge_id
      OR NOT public.m6_bridge_is_online(v_p.bridge_id)
      OR v_online_peers = 0
    ) THEN
      CONTINUE;
    END IF;

    v_win := nullif(trim(coalesce(v_p.address->>'windows_printer_name', '')), '');

    UPDATE public.printers
    SET bridge_id = p_bridge_id,
        address = CASE
          WHEN v_win IS NULL OR NOT (v_win = ANY (v_local)) THEN
            jsonb_set(
              coalesce(address, '{}'::jsonb),
              '{windows_printer_name}',
              to_jsonb(v_pick),
              true
            )
          ELSE address
        END,
        updated_at = now()
    WHERE id = v_p.id
      AND (
        bridge_id IS DISTINCT FROM p_bridge_id
        OR v_win IS NULL
        OR NOT (v_win = ANY (v_local))
      );

    IF FOUND THEN
      v_updated := v_updated + 1;
      IF v_win IS NULL OR NOT (v_win = ANY (v_local)) THEN
        v_names := v_names + 1;
      END IF;
    END IF;
  END LOOP;

  -- Align still-pending jobs to printer's bridge
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
    'renamed', v_names,
    'picked_windows_name', v_pick,
    'local_devices', to_jsonb(v_local)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- report_bridge_printers: inventory + auto-bind
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
      restaurant_id, bridge_id, windows_name, is_virtual, last_seen_at
    ) VALUES (
      v_b.restaurant_id, v_b.id, v_name, v_virtual, now()
    )
    ON CONFLICT (bridge_id, windows_name) DO UPDATE SET
      is_virtual = excluded.is_virtual,
      last_seen_at = now();

    v_seen := array_append(v_seen, v_name);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.print_bridge_devices
  WHERE bridge_id = v_b.id
    AND NOT (windows_name = ANY (v_seen));

  PERFORM public.m6_auto_bind_printers_for_bridge(v_b.id);

  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.report_bridge_printers(text, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- heartbeat: heal + auto-bind for this station
-- ---------------------------------------------------------------------------
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
  v_healed int := 0;
  v_device text;
  v_bind jsonb;
BEGIN
  v_b := public.m6_require_bridge_token(p_token);
  v_device := nullif(trim(coalesce(p_device_name, '')), '');

  UPDATE public.print_bridges SET
    device_name = coalesce(v_device, device_name),
    windows_username = coalesce(nullif(trim(coalesce(p_windows_username, '')), ''), windows_username),
    version = coalesce(nullif(trim(coalesce(p_version, '')), ''), version),
    last_heartbeat_at = now(),
    last_connected_at = now(),
    last_restart_at = CASE WHEN p_restarted THEN now() ELSE last_restart_at END,
    updated_at = now()
  WHERE id = v_b.id;

  IF coalesce(v_device, v_b.device_name) IS NOT NULL THEN
    UPDATE public.print_bridges
    SET is_active = false, updated_at = now()
    WHERE restaurant_id = v_b.restaurant_id
      AND id <> v_b.id
      AND is_active
      AND device_name IS NOT NULL
      AND lower(device_name) = lower(coalesce(v_device, v_b.device_name));
  END IF;

  UPDATE public.printers p
  SET bridge_id = v_b.id, updated_at = now()
  WHERE p.restaurant_id = v_b.restaurant_id
    AND (
      p.bridge_id IS NULL
      OR p.bridge_id = v_b.id
      OR NOT public.m6_bridge_is_online(p.bridge_id)
    );
  GET DIAGNOSTICS v_healed = ROW_COUNT;

  v_bind := public.m6_auto_bind_printers_for_bridge(v_b.id);

  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_b.restaurant_id;

  RETURN jsonb_build_object(
    'bridge_id', v_b.id,
    'restaurant_id', v_b.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'printers_healed', coalesce(v_healed, 0),
    'auto_bind', v_bind
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(text, text, text, text, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- One-shot heal for currently online bridges
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.print_bridges
    WHERE is_active
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at > now() - interval '2 minutes'
  LOOP
    PERFORM public.m6_auto_bind_printers_for_bridge(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Manager diagnostics checklist
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnose_print_system()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_online public.print_bridges%ROWTYPE;
  v_checks jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_detail text;
  v_ok boolean;
  v_cashier public.printers%ROWTYPE;
  v_kitchen public.printers%ROWTYPE;
  v_devices int;
  v_pending int;
  v_win text;
  v_local text[];
  v_reject jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  -- 1) Supabase / auth context
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'supabase',
    'ok', true,
    'label', 'متصل بـ Supabase',
    'detail', v_rest::text
  ));

  -- 2) Heartbeat / online bridge
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
    'label', 'Heartbeat',
    'detail', CASE WHEN v_ok THEN
      format('%s · %s · منذ %s ث',
        coalesce(v_online.device_name, v_online.display_name),
        coalesce(v_online.version, '?'),
        greatest(0, trunc(extract(epoch from (now() - v_online.last_heartbeat_at))))::text)
      ELSE 'لا يوجد Bridge متصل خلال 45 ثانية' END
  ));

  -- 3) Poll / claim capability
  v_ok := v_online.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'poll',
    'ok', v_ok,
    'label', 'Poll يعمل (جسر متصل قابل للالتقاط)',
    'detail', CASE WHEN v_ok THEN v_online.id::text ELSE 'لا يمكن الالتقاط بدون جسر متصل' END
  ));

  -- 4) Devices inventory
  SELECT count(*) INTO v_devices FROM public.print_bridge_devices d
  WHERE d.bridge_id = v_online.id AND d.is_virtual = false
    AND d.last_seen_at > now() - interval '15 minutes';
  v_ok := v_online.id IS NOT NULL AND v_devices > 0;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'printer_exists',
    'ok', v_ok,
    'label', 'الطابعة موجودة (مخزون Windows)',
    'detail', CASE WHEN v_ok THEN format('%s طابعة محلية', v_devices)
      ELSE 'الجسر لم يبلّغ عن طابعات Windows غير افتراضية' END
  ));

  -- 5) Default role printers
  SELECT * INTO v_cashier FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'cashier' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  SELECT * INTO v_kitchen FROM public.printers
  WHERE restaurant_id = v_rest AND role = 'kitchen' AND is_active
  ORDER BY sort_order, name LIMIT 1;
  v_ok := v_cashier.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'default_printer',
    'ok', v_ok,
    'label', 'الطابعة الافتراضية (كاشير)',
    'detail', CASE WHEN v_ok THEN v_cashier.name ELSE 'لا توجد طابعة كاشير نشطة' END
  ));

  -- 6) Device / Bridge ID
  v_ok := v_online.id IS NOT NULL;
  IF NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'device_id',
    'ok', v_ok,
    'label', 'Device / Bridge ID',
    'detail', CASE WHEN v_ok THEN
      format('bridge=%s · device=%s', v_online.id, coalesce(v_online.device_name, '—'))
      ELSE '—' END
  ));

  -- 7) Bridge version
  v_ok := v_online.version IS NOT NULL AND v_online.version >= '0.3.13';
  IF v_online.id IS NOT NULL AND NOT v_ok THEN v_ready := false; END IF;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'bridge_version',
    'ok', coalesce(v_ok, false),
    'label', 'إصدار Bridge',
    'detail', coalesce(v_online.version, 'غير معروف')
  ));

  -- 8) Name match on online bridge
  IF v_online.id IS NOT NULL AND v_cashier.id IS NOT NULL THEN
    SELECT coalesce(array_agg(d.windows_name), ARRAY[]::text[]) INTO v_local
    FROM public.print_bridge_devices d
    WHERE d.bridge_id = v_online.id AND d.is_virtual = false
      AND d.last_seen_at > now() - interval '15 minutes';
    v_win := nullif(trim(coalesce(v_cashier.address->>'windows_printer_name', '')), '');
    v_ok := v_win IS NOT NULL AND v_win = ANY (v_local)
      AND (v_cashier.bridge_id IS NULL OR v_cashier.bridge_id = v_online.id
           OR NOT public.m6_bridge_is_online(v_cashier.bridge_id));
    IF NOT v_ok THEN v_ready := false; END IF;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match',
      'ok', v_ok,
      'label', 'اسم Windows يطابق الجهاز المتصل',
      'detail', CASE WHEN v_ok THEN v_win
        ELSE format('المضبوط=%s · المحلي=%s · bridge_id=%s',
          coalesce(v_win, '—'),
          coalesce(array_to_string(v_local, ', '), '—'),
          coalesce(v_cashier.bridge_id::text, '—'))
        END
    ));
  ELSE
    v_ready := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'id', 'name_match', 'ok', false,
      'label', 'اسم Windows يطابق الجهاز المتصل',
      'detail', 'تعذّر الفحص'
    ));
  END IF;

  -- 9) Queue / claimability snapshot
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
    'id', 'queue',
    'ok', v_ok,
    'label', 'قائمة الطباعة / قابلية الالتقاط',
    'detail', format('مهام نشطة: %s', v_pending)
  ));

  -- 10) Test readiness summary
  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'id', 'test_ready',
    'ok', v_ready,
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
    'pending_jobs', v_reject,
    'printers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'role', p.role,
        'bridge_id', p.bridge_id,
        'windows_printer_name', p.address->>'windows_printer_name',
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
END; $$;

GRANT EXECUTE ON FUNCTION public.diagnose_print_system() TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_auto_bind_printers_for_bridge(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_print_station_bindings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_b uuid;
  v_result jsonb;
BEGIN
  IF v_rest IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  SELECT id INTO v_b FROM public.print_bridges
  WHERE restaurant_id = v_rest AND is_active
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at > now() - interval '45 seconds'
  ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  IF v_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ONLINE_BRIDGE');
  END IF;
  v_result := public.m6_auto_bind_printers_for_bridge(v_b);
  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('bridge_id', v_b);
END; $$;

GRANT EXECUTE ON FUNCTION public.sync_print_station_bindings() TO authenticated;

NOTIFY pgrst, 'reload schema';
