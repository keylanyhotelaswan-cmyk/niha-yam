-- Fix: Pending → TTL_EXPIRED with attempt_count=0 while Bridge is online.
--
-- Proven on production (2026-07-14):
--   - Heartbeat / Print Center show an online Bridge (e.g. d0bb… / 0.3.13).
--   - Jobs stamp job.bridge_id from printers.bridge_id (e.g. 84eb… or 51921…).
--   - claim_print_jobs required job.bridge_id = claiming bridge AND
--     printers.bridge_id = claiming bridge.
--   - Extra active / zombie Bridges (re-pairs, test tokens, diag heartbeats) leave
--     printers + jobs routed to a Bridge that is not the one polling → claim [] forever
--     → m6_expire_stale_print_jobs sets expired + TTL_EXPIRED with attempt_count=0.
--
-- Fix:
--   1) Claim jobs stamped for this Bridge OR for Bridges that are offline / inactive.
--   2) Trust job.bridge_id when it already matches the claimer (stale printer.bridge_id).
--   3) Heartbeat rebinds printers away from offline Bridges; soft-deactivates long-idle peers.
--   4) One-shot heal of printer bindings + diagnose RPC for temporary Bridge logging.

-- ---------------------------------------------------------------------------
-- One-shot: rebind printers whose Bridge is inactive OR offline (>45s)
-- ---------------------------------------------------------------------------
UPDATE public.printers p
SET bridge_id = sub.bridge_id,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (p2.id)
    p2.id AS printer_id,
    b.id AS bridge_id
  FROM public.printers p2
  JOIN public.print_bridges b
    ON b.restaurant_id = p2.restaurant_id
   AND b.is_active
   AND b.last_heartbeat_at IS NOT NULL
   AND b.last_heartbeat_at > now() - interval '45 seconds'
  WHERE p2.bridge_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.print_bridges xb
       WHERE xb.id = p2.bridge_id
         AND xb.is_active
         AND xb.last_heartbeat_at IS NOT NULL
         AND xb.last_heartbeat_at > now() - interval '45 seconds'
     )
  ORDER BY p2.id, b.last_heartbeat_at DESC NULLS LAST
) sub
WHERE p.id = sub.printer_id;

UPDATE public.print_jobs j
SET bridge_id = p.bridge_id,
    updated_at = now()
FROM public.printers p
WHERE j.printer_id = p.id
  AND j.status IN ('pending', 'retry_wait')
  AND (j.expires_at IS NULL OR j.expires_at > now())
  AND p.bridge_id IS NOT NULL
  AND (j.bridge_id IS DISTINCT FROM p.bridge_id);

-- Note: do NOT mass-deactivate idle Bridges here — that would brick offline
-- tokens (m6_require_bridge_token requires is_active). Peer cleanup happens
-- on heartbeat of a live Bridge only.

-- ---------------------------------------------------------------------------
-- claim: online Bridge may take jobs routed to offline / inactive peers
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
      AND (
        v_bridge_id IS NULL
        OR j.bridge_id IS NULL
        OR j.bridge_id = v_bridge_id
        OR NOT EXISTS (
          SELECT 1 FROM public.print_bridges xb
          WHERE xb.id = j.bridge_id
            AND xb.is_active
            AND xb.last_heartbeat_at IS NOT NULL
            AND xb.last_heartbeat_at > now() - interval '45 seconds'
        )
      )
      AND (
        v_bridge_id IS NULL
        OR j.printer_id IS NULL
        OR j.bridge_id = v_bridge_id
        OR EXISTS (
          SELECT 1 FROM public.printers p
          WHERE p.id = j.printer_id
            AND (
              p.bridge_id IS NULL
              OR p.bridge_id = v_bridge_id
              OR NOT EXISTS (
                SELECT 1 FROM public.print_bridges pb
                WHERE pb.id = p.bridge_id
                  AND pb.is_active
                  AND pb.last_heartbeat_at IS NOT NULL
                  AND pb.last_heartbeat_at > now() - interval '45 seconds'
              )
            )
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

GRANT EXECUTE ON FUNCTION public.claim_print_jobs(uuid, int, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue: heal printer.bridge_id when falling back to an online Bridge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_enqueue_document_print(
  p_order_id uuid,
  p_kind public.print_job_kind,
  p_is_reprint boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_rest uuid;
  v_staff uuid := public.auth_staff_id();
  v_role public.printer_role;
  v_printer_id uuid;
  v_printer public.printers%ROWTYPE;
  v_tpl uuid;
  v_tpl_ver int;
  v_bridge_id uuid;
  v_win text;
  v_ref text;
  v_pj uuid;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_rest := v_o.restaurant_id;

  IF p_kind NOT IN ('receipt', 'kitchen') THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;

  IF p_is_reprint AND length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  INSERT INTO public.print_settings (restaurant_id)
  VALUES (v_rest) ON CONFLICT (restaurant_id) DO NOTHING;

  v_role := CASE
    WHEN p_kind = 'kitchen' THEN 'kitchen'::public.printer_role
    ELSE 'cashier'::public.printer_role
  END;

  v_printer_id := public.m6_default_printer_for_role(v_rest, v_role);
  IF v_printer_id IS NULL THEN
    PERFORM public.record_order_event(p_order_id, 'print.skipped', 'order', p_order_id,
      jsonb_build_object('kind', p_kind::text, 'reason', 'NO_PRINTER'));
    PERFORM public.m6_refresh_order_print_status(p_order_id);
    RETURN NULL;
  END IF;

  SELECT * INTO v_printer FROM public.printers WHERE id = v_printer_id;
  IF NOT v_printer.is_active THEN
    PERFORM public.record_order_event(p_order_id, 'print.skipped', 'order', p_order_id,
      jsonb_build_object('kind', p_kind::text, 'reason', 'PRINTER_INACTIVE'));
    PERFORM public.m6_refresh_order_print_status(p_order_id);
    RETURN NULL;
  END IF;

  v_win := nullif(trim(coalesce(v_printer.address->>'windows_printer_name', '')), '');
  IF v_printer.connection = 'windows_spooler' AND v_win IS NULL THEN
    PERFORM public.record_order_event(p_order_id, 'print.skipped', 'order', p_order_id,
      jsonb_build_object('kind', p_kind::text, 'reason', 'WINDOWS_PRINTER_REQUIRED'));
    PERFORM public.m6_refresh_order_print_status(p_order_id);
    RETURN NULL;
  END IF;

  IF v_printer.bridge_id IS NOT NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE id = v_printer.bridge_id
      AND restaurant_id = v_rest
      AND is_active
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at > now() - interval '45 seconds';
  END IF;
  IF v_bridge_id IS NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE restaurant_id = v_rest
      AND is_active
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at > now() - interval '45 seconds'
    ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_bridge_id IS NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE restaurant_id = v_rest AND is_active
    ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_bridge_id IS NOT NULL AND v_printer.bridge_id IS DISTINCT FROM v_bridge_id THEN
    UPDATE public.printers
    SET bridge_id = v_bridge_id, updated_at = now()
    WHERE id = v_printer_id;
    v_printer.bridge_id := v_bridge_id;
  END IF;

  v_tpl := public.m6_default_template_for_kind(v_rest, p_kind);
  IF v_tpl IS NOT NULL THEN
    SELECT version INTO v_tpl_ver FROM public.print_templates WHERE id = v_tpl;
  END IF;

  v_payload := public.m6_build_order_print_payload(p_order_id, p_kind);
  v_payload := jsonb_set(
    v_payload,
    '{data_snapshot,footer_text}',
    to_jsonb(v_printer.footer_text),
    true
  );
  v_payload := jsonb_set(
    v_payload,
    '{data_snapshot,printer_name}',
    to_jsonb(v_printer.name),
    true
  );
  IF v_win IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('windows_printer_name', v_win);
  END IF;
  IF p_is_reprint THEN
    v_payload := v_payload || jsonb_build_object('reprint', true, 'reason', trim(p_reason));
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, payload,
    printer_id, bridge_id, template_id, template_version,
    is_reprint, reprint_reason
  ) VALUES (
    v_rest, p_order_id, v_ref, p_kind, 'pending', v_payload,
    v_printer_id, v_bridge_id, v_tpl, v_tpl_ver,
    coalesce(p_is_reprint, false),
    CASE WHEN p_is_reprint THEN trim(p_reason) ELSE NULL END
  ) RETURNING id INTO v_pj;

  PERFORM public.record_order_event(p_order_id, 'print.enqueued', 'print_job', v_pj,
    jsonb_build_object(
      'kind', p_kind::text,
      'reference', v_ref,
      'reprint', coalesce(p_is_reprint, false),
      'reason', CASE WHEN p_is_reprint THEN trim(p_reason) ELSE NULL END
    ));

  IF p_is_reprint AND v_staff IS NOT NULL THEN
    PERFORM public.log_audit_event(v_rest, 'order.reprinted', NULL, v_staff, 'order', p_order_id, NULL,
      jsonb_build_object('kind', p_kind::text, 'reason', trim(p_reason), 'job_id', v_pj));
  END IF;

  PERFORM public.m6_refresh_order_print_status(p_order_id);
  RETURN v_pj;
END; $$;

-- ---------------------------------------------------------------------------
-- Heartbeat: reclaim printers from offline peers; soft-deactivate long-idle
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

  UPDATE public.print_bridges
  SET is_active = false, updated_at = now()
  WHERE restaurant_id = v_b.restaurant_id
    AND id <> v_b.id
    AND is_active
    AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '10 minutes');

  UPDATE public.printers p
  SET bridge_id = v_b.id, updated_at = now()
  WHERE p.restaurant_id = v_b.restaurant_id
    AND (
      p.bridge_id IS NULL
      OR p.bridge_id = v_b.id
      OR NOT EXISTS (
        SELECT 1 FROM public.print_bridges xb
        WHERE xb.id = p.bridge_id
          AND xb.is_active
          AND xb.last_heartbeat_at IS NOT NULL
          AND xb.last_heartbeat_at > now() - interval '45 seconds'
      )
    );
  GET DIAGNOSTICS v_healed = ROW_COUNT;

  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_b.restaurant_id;

  RETURN jsonb_build_object(
    'bridge_id', v_b.id,
    'restaurant_id', v_b.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'printers_healed', coalesce(v_healed, 0)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(text, text, text, text, boolean) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Temporary diagnose RPC (Bridge token) — why claim returns []
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnose_bridge_claim(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
BEGIN
  v_b := public.m6_require_bridge_token(p_token);

  RETURN jsonb_build_object(
    'bridge_id', v_b.id,
    'restaurant_id', v_b.restaurant_id,
    'pending_jobs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', j.id,
        'reference', j.reference,
        'status', j.status,
        'attempt_count', j.attempt_count,
        'printer_id', j.printer_id,
        'job_bridge_id', j.bridge_id,
        'printer_bridge_id', p.bridge_id,
        'job_bridge_online', EXISTS (
          SELECT 1 FROM public.print_bridges xb
          WHERE xb.id = j.bridge_id
            AND xb.is_active
            AND xb.last_heartbeat_at IS NOT NULL
            AND xb.last_heartbeat_at > now() - interval '45 seconds'
        ),
        'expires_at', j.expires_at,
        'reject_reason', CASE
          WHEN j.expires_at IS NOT NULL AND j.expires_at <= now() THEN 'EXPIRED'
          WHEN j.bridge_id IS NOT NULL
            AND j.bridge_id <> v_b.id
            AND EXISTS (
              SELECT 1 FROM public.print_bridges xb
              WHERE xb.id = j.bridge_id
                AND xb.is_active
                AND xb.last_heartbeat_at IS NOT NULL
                AND xb.last_heartbeat_at > now() - interval '45 seconds'
            )
            THEN 'JOB_ROUTED_TO_OTHER_ONLINE_BRIDGE'
          WHEN j.status = 'retry_wait' AND coalesce(j.next_attempt_at, now()) > now()
            THEN 'RETRY_WAIT'
          ELSE 'CLAIMABLE'
        END
      ) ORDER BY j.created_at DESC)
      FROM public.print_jobs j
      LEFT JOIN public.printers p ON p.id = j.printer_id
      WHERE j.restaurant_id = v_b.restaurant_id
        AND j.status IN ('pending', 'retry_wait', 'claimed', 'printing')
    ), '[]'::jsonb),
    'printers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'role', p.role,
        'bridge_id', p.bridge_id,
        'bridge_online', EXISTS (
          SELECT 1 FROM public.print_bridges xb
          WHERE xb.id = p.bridge_id
            AND xb.is_active
            AND xb.last_heartbeat_at IS NOT NULL
            AND xb.last_heartbeat_at > now() - interval '45 seconds'
        ),
        'windows_printer_name', p.address->>'windows_printer_name'
      ) ORDER BY p.sort_order, p.name)
      FROM public.printers p
      WHERE p.restaurant_id = v_b.restaurant_id AND p.is_active
    ), '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.diagnose_bridge_claim(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
