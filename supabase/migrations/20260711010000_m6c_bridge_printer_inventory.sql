-- M6C: Bridge printer inventory + Print Center ownership (execution agent vs admin)

CREATE TABLE IF NOT EXISTS public.print_bridge_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  bridge_id uuid NOT NULL REFERENCES public.print_bridges (id) ON DELETE CASCADE,
  windows_name text NOT NULL,
  is_virtual boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_bridge_device_name CHECK (length(trim(windows_name)) > 0),
  CONSTRAINT uq_bridge_device UNIQUE (bridge_id, windows_name)
);

CREATE INDEX IF NOT EXISTS idx_bridge_devices_rest
  ON public.print_bridge_devices (restaurant_id, bridge_id);

ALTER TABLE public.print_bridge_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS print_bridge_devices_select ON public.print_bridge_devices;
CREATE POLICY print_bridge_devices_select ON public.print_bridge_devices
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Bridge reports discovered Windows printers
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

  -- Drop devices no longer reported (stale inventory)
  DELETE FROM public.print_bridge_devices
  WHERE bridge_id = v_b.id
    AND NOT (windows_name = ANY (v_seen));

  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.report_bridge_printers(text, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- List bridges + discovered devices (Print Center)
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
        'online', (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '30 seconds'),
        'is_active', b.is_active,
        'devices', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'windows_name', d.windows_name,
            'is_virtual', d.is_virtual,
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
            AND d.last_seen_at > now() - interval '10 minutes'
        ), '[]'::jsonb)
      ) AS row,
      (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '30 seconds') AS online,
      b.last_heartbeat_at
      FROM public.print_bridges b
      WHERE b.restaurant_id = v_rest AND b.is_active
    ) s
  ), '[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.list_print_bridges() TO authenticated;

-- ---------------------------------------------------------------------------
-- list_printers: include bridge_id + windows_printer_name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_printers(p_active_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY sort_order, name)
    FROM (
      SELECT jsonb_build_object(
        'id', p.id, 'name', p.name, 'role', p.role, 'device_type', p.device_type,
        'connection', p.connection, 'address', p.address,
        'windows_printer_name', p.address->>'windows_printer_name',
        'bridge_id', p.bridge_id,
        'bridge_name', (SELECT display_name FROM public.print_bridges b WHERE b.id = p.bridge_id),
        'paper_width_mm', p.paper_width_mm, 'encoding', p.encoding,
        'default_copies', p.default_copies, 'auto_cut', p.auto_cut,
        'open_cash_drawer', p.open_cash_drawer, 'logo_url', p.logo_url,
        'footer_text', p.footer_text, 'is_active', p.is_active,
        'sort_order', p.sort_order, 'last_error', p.last_error,
        'last_success_at', p.last_success_at
      ) AS row, p.sort_order, p.name
      FROM public.printers p
      WHERE p.restaurant_id = v_rest
        AND (NOT p_active_only OR p.is_active)
    ) s
  ), '[]'::jsonb);
END; $$;

-- ---------------------------------------------------------------------------
-- upsert_printer: accept bridge_id + windows_printer_name
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_printer(
  uuid, text, public.printer_role, text, public.printer_connection, jsonb,
  int, text, int, boolean, boolean, text, text, boolean, int
);

CREATE OR REPLACE FUNCTION public.upsert_printer(
  p_id uuid,
  p_name text,
  p_role public.printer_role,
  p_device_type text DEFAULT 'thermal',
  p_connection public.printer_connection DEFAULT 'windows_spooler',
  p_address jsonb DEFAULT '{}'::jsonb,
  p_paper_width_mm int DEFAULT 80,
  p_encoding text DEFAULT 'CP864',
  p_default_copies int DEFAULT 1,
  p_auto_cut boolean DEFAULT true,
  p_open_cash_drawer boolean DEFAULT false,
  p_logo_url text DEFAULT NULL,
  p_footer_text text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_sort_order int DEFAULT 0,
  p_bridge_id uuid DEFAULT NULL,
  p_windows_printer_name text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_addr jsonb;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;

  IF p_bridge_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.print_bridges WHERE id = p_bridge_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_addr := coalesce(p_address, '{}'::jsonb);
  IF p_windows_printer_name IS NOT NULL THEN
    v_addr := v_addr || jsonb_build_object(
      'windows_printer_name', nullif(trim(p_windows_printer_name), '')
    );
  END IF;

  IF p_connection = 'windows_spooler'
     AND nullif(trim(coalesce(v_addr->>'windows_printer_name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'WINDOWS_PRINTER_REQUIRED';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.printers (
      restaurant_id, name, role, device_type, connection, address, paper_width_mm,
      encoding, default_copies, auto_cut, open_cash_drawer, logo_url, footer_text,
      is_active, sort_order, bridge_id
    ) VALUES (
      v_rest, trim(p_name), p_role, coalesce(nullif(trim(p_device_type), ''), 'thermal'),
      p_connection, v_addr, coalesce(p_paper_width_mm, 80),
      coalesce(nullif(trim(p_encoding), ''), 'CP864'), coalesce(p_default_copies, 1),
      coalesce(p_auto_cut, true), coalesce(p_open_cash_drawer, false),
      nullif(trim(coalesce(p_logo_url, '')), ''), nullif(trim(coalesce(p_footer_text, '')), ''),
      coalesce(p_is_active, true), coalesce(p_sort_order, 0), p_bridge_id
    ) RETURNING id INTO v_id;
    PERFORM public.log_audit_event(v_rest, 'printer.created', NULL, v_actor, 'printer', v_id, NULL,
      jsonb_build_object('name', trim(p_name), 'role', p_role, 'bridge_id', p_bridge_id));
  ELSE
    UPDATE public.printers SET
      name = trim(p_name), role = p_role,
      device_type = coalesce(nullif(trim(p_device_type), ''), device_type),
      connection = p_connection, address = v_addr,
      paper_width_mm = coalesce(p_paper_width_mm, paper_width_mm),
      encoding = coalesce(nullif(trim(p_encoding), ''), encoding),
      default_copies = coalesce(p_default_copies, default_copies),
      auto_cut = coalesce(p_auto_cut, auto_cut),
      open_cash_drawer = coalesce(p_open_cash_drawer, open_cash_drawer),
      logo_url = nullif(trim(coalesce(p_logo_url, '')), ''),
      footer_text = nullif(trim(coalesce(p_footer_text, '')), ''),
      is_active = coalesce(p_is_active, is_active),
      sort_order = coalesce(p_sort_order, sort_order),
      bridge_id = p_bridge_id,
      updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    PERFORM public.log_audit_event(v_rest, 'printer.updated', NULL, v_actor, 'printer', v_id, NULL,
      jsonb_build_object('name', trim(p_name), 'role', p_role, 'bridge_id', p_bridge_id));
  END IF;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.upsert_printer(
  uuid, text, public.printer_role, text, public.printer_connection, jsonb,
  int, text, int, boolean, boolean, text, text, boolean, int, uuid, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- enqueue_test_print: stamp bridge_id from printer; require windows name
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_test_print(p_printer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_p public.printers%ROWTYPE;
  v_ref text;
  v_pj uuid;
  v_bridge public.print_bridges%ROWTYPE;
  v_win text;
BEGIN
  SELECT * INTO v_p FROM public.printers WHERE id = p_printer_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT v_p.is_active THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_win := nullif(trim(coalesce(v_p.address->>'windows_printer_name', '')), '');
  IF v_p.connection = 'windows_spooler' AND v_win IS NULL THEN
    RAISE EXCEPTION 'WINDOWS_PRINTER_REQUIRED';
  END IF;

  IF v_p.bridge_id IS NOT NULL THEN
    SELECT * INTO v_bridge FROM public.print_bridges
    WHERE id = v_p.bridge_id AND restaurant_id = v_rest AND is_active;
  ELSE
    SELECT * INTO v_bridge FROM public.print_bridges
    WHERE restaurant_id = v_rest AND is_active
    ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_bridge.id IS NULL THEN
    RAISE EXCEPTION 'BRIDGE_REQUIRED';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, printer_id, bridge_id, payload
  ) VALUES (
    v_rest, NULL, v_ref, 'test_page', 'pending', p_printer_id, v_bridge.id,
    jsonb_build_object(
      'test_page', true,
      'printer_name', v_p.name,
      'windows_printer_name', v_win,
      'connection', v_p.connection,
      'printed_at', now(),
      'bridge_version', v_bridge.version
    )
  ) RETURNING id INTO v_pj;

  PERFORM public.log_audit_event(v_rest, 'print.test_enqueued', NULL, v_actor, 'print_job', v_pj, NULL,
    jsonb_build_object('printer_id', p_printer_id, 'bridge_id', v_bridge.id));
  RETURN v_pj;
END; $$;

-- ---------------------------------------------------------------------------
-- Health: all bridges
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_printer_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  RETURN jsonb_build_object(
    'bridge', (
      SELECT jsonb_build_object(
        'id', b.id, 'display_name', b.display_name, 'device_name', b.device_name,
        'windows_username', b.windows_username, 'version', b.version,
        'last_heartbeat_at', b.last_heartbeat_at, 'last_connected_at', b.last_connected_at,
        'last_restart_at', b.last_restart_at,
        'online', (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '30 seconds')
      )
      FROM public.print_bridges b
      WHERE b.restaurant_id = v_rest AND b.is_active
      ORDER BY b.last_heartbeat_at DESC NULLS LAST LIMIT 1
    ),
    'bridges', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'display_name', b.display_name, 'device_name', b.device_name,
        'windows_username', b.windows_username, 'version', b.version,
        'last_heartbeat_at', b.last_heartbeat_at,
        'online', (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '30 seconds'),
        'device_count', (SELECT count(*) FROM public.print_bridge_devices d
          WHERE d.bridge_id = b.id AND d.last_seen_at > now() - interval '10 minutes')
      ) ORDER BY b.last_heartbeat_at DESC NULLS LAST)
      FROM public.print_bridges b WHERE b.restaurant_id = v_rest AND b.is_active
    ), '[]'::jsonb),
    'queue', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.print_jobs WHERE restaurant_id = v_rest AND status IN ('pending', 'claimed', 'printing', 'retry_wait')),
      'failed', (SELECT count(*) FROM public.print_jobs WHERE restaurant_id = v_rest AND status = 'failed'),
      'completed_today', (SELECT count(*) FROM public.print_jobs
        WHERE restaurant_id = v_rest AND status = 'completed' AND completed_at::date = current_date)
    ),
    'printers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'role', p.role, 'is_active', p.is_active,
        'connection', p.connection, 'last_success_at', p.last_success_at,
        'last_error', p.last_error, 'bridge_id', p.bridge_id,
        'windows_printer_name', p.address->>'windows_printer_name',
        'pending_jobs', (SELECT count(*) FROM public.print_jobs j
          WHERE j.printer_id = p.id AND j.status IN ('pending', 'claimed', 'printing', 'retry_wait'))
      ) ORDER BY p.sort_order)
      FROM public.printers p WHERE p.restaurant_id = v_rest
    ), '[]'::jsonb)
  );
END; $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- claim: prefer jobs stamped for this bridge (multi-bridge safe)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_print_jobs(
  p_bridge_id uuid DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_token text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid;
  v_bridge_id uuid;
  v_b public.print_bridges%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF p_token IS NOT NULL AND length(trim(p_token)) > 0 THEN
    v_b := public.m6_require_bridge_token(p_token);
    v_rest := v_b.restaurant_id;
    v_bridge_id := v_b.id;
  ELSE
    v_rest := public.m4_require_manager();
    v_bridge_id := p_bridge_id;
    IF v_bridge_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.print_bridges WHERE id = v_bridge_id AND restaurant_id = v_rest
    ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;

  PERFORM public.m6_expire_stale_print_jobs(v_rest);

  UPDATE public.print_jobs
  SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = now()
  WHERE restaurant_id = v_rest
    AND status = 'claimed'
    AND claimed_at < now() - interval '2 minutes';

  WITH picked AS (
    SELECT j.id
    FROM public.print_jobs j
    WHERE j.restaurant_id = v_rest
      AND j.status IN ('pending', 'retry_wait')
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (j.status = 'pending' OR coalesce(j.next_attempt_at, now()) <= now())
      AND (j.bridge_id IS NULL OR j.bridge_id = v_bridge_id OR v_bridge_id IS NULL)
      AND (
        v_bridge_id IS NULL
        OR j.printer_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.printers p
          WHERE p.id = j.printer_id
            AND (p.bridge_id IS NULL OR p.bridge_id = v_bridge_id)
        )
      )
    ORDER BY j.created_at
    LIMIT greatest(coalesce(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.print_jobs j
    SET status = 'claimed',
        claimed_by = v_bridge_id,
        claimed_at = now(),
        bridge_id = coalesce(v_bridge_id, j.bridge_id),
        updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM upd;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', j.id, 'reference', j.reference, 'kind', j.kind, 'order_id', j.order_id,
      'printer_id', j.printer_id, 'template_id', j.template_id,
      'template_version', j.template_version, 'payload', j.payload,
      'attempt_count', j.attempt_count, 'is_reprint', j.is_reprint,
      'expires_at', j.expires_at,
      'printer', (
        SELECT jsonb_build_object(
          'id', p.id, 'name', p.name, 'connection', p.connection,
          'address', p.address, 'paper_width_mm', p.paper_width_mm,
          'encoding', p.encoding, 'auto_cut', p.auto_cut,
          'open_cash_drawer', p.open_cash_drawer, 'default_copies', p.default_copies
        ) FROM public.printers p WHERE p.id = j.printer_id
      ),
      'template_body', (SELECT body FROM public.print_templates t WHERE t.id = j.template_id)
    ) ORDER BY j.created_at)
    FROM public.print_jobs j
    WHERE j.id = ANY (v_ids)
  ), '[]'::jsonb);
END; $$;
