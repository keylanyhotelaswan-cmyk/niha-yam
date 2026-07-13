-- M6B RPCs: settings, pair, bridge-token claim/report, expire, delivery

-- ---------------------------------------------------------------------------
-- Print settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_print_settings()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id(); v_row public.print_settings%ROWTYPE;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  INSERT INTO public.print_settings (restaurant_id) VALUES (v_rest)
  ON CONFLICT (restaurant_id) DO NOTHING;
  SELECT * INTO v_row FROM public.print_settings WHERE restaurant_id = v_rest;
  RETURN jsonb_build_object(
    'print_job_ttl_minutes', v_row.print_job_ttl_minutes,
    'default_copies', v_row.default_copies,
    'open_cash_drawer', v_row.open_cash_drawer,
    'auto_cut', v_row.auto_cut,
    'paper_width_mm', v_row.paper_width_mm,
    'show_qr_on_receipt', v_row.show_qr_on_receipt,
    'kitchen_show_prices', v_row.kitchen_show_prices,
    'thank_you_message', v_row.thank_you_message
  );
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_print_settings(
  p_print_job_ttl_minutes int DEFAULT NULL,
  p_default_copies int DEFAULT NULL,
  p_open_cash_drawer boolean DEFAULT NULL,
  p_auto_cut boolean DEFAULT NULL,
  p_paper_width_mm int DEFAULT NULL,
  p_show_qr_on_receipt boolean DEFAULT NULL,
  p_kitchen_show_prices boolean DEFAULT NULL,
  p_thank_you_message text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  INSERT INTO public.print_settings (restaurant_id) VALUES (v_rest)
  ON CONFLICT (restaurant_id) DO NOTHING;
  UPDATE public.print_settings SET
    print_job_ttl_minutes = coalesce(p_print_job_ttl_minutes, print_job_ttl_minutes),
    default_copies = coalesce(p_default_copies, default_copies),
    open_cash_drawer = coalesce(p_open_cash_drawer, open_cash_drawer),
    auto_cut = coalesce(p_auto_cut, auto_cut),
    paper_width_mm = coalesce(p_paper_width_mm, paper_width_mm),
    show_qr_on_receipt = coalesce(p_show_qr_on_receipt, show_qr_on_receipt),
    kitchen_show_prices = coalesce(p_kitchen_show_prices, kitchen_show_prices),
    thank_you_message = CASE
      WHEN p_thank_you_message IS NULL THEN thank_you_message
      ELSE nullif(trim(p_thank_you_message), '')
    END,
    updated_at = now()
  WHERE restaurant_id = v_rest;
  RETURN public.get_print_settings();
END; $$;

-- ---------------------------------------------------------------------------
-- Pairing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_print_bridge_pair_code()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_code text;
  v_id uuid;
  v_exp timestamptz := now() + interval '10 minutes';
BEGIN
  -- 8-char alphanumeric
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.print_bridge_pair_codes (restaurant_id, code, expires_at, created_by)
  VALUES (v_rest, v_code, v_exp, public.auth_staff_id())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'id', v_id, 'code', v_code, 'expires_at', v_exp,
    'qr_payload', jsonb_build_object('code', v_code, 'restaurant_id', v_rest)
  );
END; $$;

-- Callable without staff session (Bridge uses anon key + code)
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
BEGIN
  IF length(trim(coalesce(p_code, ''))) < 6 THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

  SELECT * INTO v_pc FROM public.print_bridge_pair_codes
  WHERE code = upper(trim(p_code))
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CODE'; END IF;

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
    'restaurant_id', v_pc.restaurant_id
  );
END; $$;

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(
  p_token text,
  p_device_name text DEFAULT NULL,
  p_windows_username text DEFAULT NULL,
  p_version text DEFAULT NULL,
  p_restarted boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b public.print_bridges%ROWTYPE;
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
  RETURN v_b.id;
END; $$;

-- ---------------------------------------------------------------------------
-- Claim / report with bridge token OR manager (tests)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_print_jobs(uuid, int);
DROP FUNCTION IF EXISTS public.report_print_attempt(uuid, boolean, text, text, uuid);

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

  -- Release stale claims (> 2 min)
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

CREATE OR REPLACE FUNCTION public.report_print_attempt(
  p_job_id uuid,
  p_success boolean,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_bridge_id uuid DEFAULT NULL,
  p_token text DEFAULT NULL,
  p_delivery public.print_delivery DEFAULT 'transport_ack'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid;
  v_actor uuid;
  v_j public.print_jobs%ROWTYPE;
  v_b public.print_bridges%ROWTYPE;
  v_attempt int;
  v_backoff int;
  v_delivery public.print_delivery;
BEGIN
  IF p_token IS NOT NULL AND length(trim(p_token)) > 0 THEN
    v_b := public.m6_require_bridge_token(p_token);
    v_rest := v_b.restaurant_id;
    v_actor := NULL;
    p_bridge_id := v_b.id;
  ELSE
    v_rest := public.m4_require_manager();
    v_actor := public.auth_staff_id();
  END IF;

  SELECT * INTO v_j FROM public.print_jobs WHERE id = p_job_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Idempotent: already terminal
  IF v_j.status = 'completed' AND p_success THEN RETURN; END IF;
  IF v_j.status IN ('cancelled', 'expired') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  -- TTL: do not complete auto-print after expiry
  IF v_j.expires_at IS NOT NULL AND v_j.expires_at < now() THEN
    UPDATE public.print_jobs SET
      status = 'expired', last_error = 'TTL_EXPIRED',
      claimed_by = NULL, claimed_at = NULL, updated_at = now()
    WHERE id = p_job_id;
    IF v_j.order_id IS NOT NULL THEN PERFORM public.m6_refresh_order_print_status(v_j.order_id); END IF;
    RETURN;
  END IF;

  v_delivery := coalesce(p_delivery, 'transport_ack'::public.print_delivery);
  v_attempt := v_j.attempt_count + 1;

  INSERT INTO public.print_attempts (
    restaurant_id, print_job_id, bridge_id, attempt_no, status,
    error_code, error_message, delivery, finished_at
  ) VALUES (
    v_rest, p_job_id, coalesce(p_bridge_id, v_j.claimed_by), v_attempt,
    CASE WHEN p_success THEN 'success' ELSE 'failure' END,
    nullif(trim(coalesce(p_error_code, '')), ''),
    nullif(trim(coalesce(p_error_message, '')), ''),
    CASE WHEN p_success THEN v_delivery ELSE NULL END,
    now()
  );

  IF p_success THEN
    UPDATE public.print_jobs SET
      status = 'completed', attempt_count = v_attempt, last_error = NULL,
      delivery = v_delivery, completed_at = now(),
      claimed_by = NULL, claimed_at = NULL, updated_at = now()
    WHERE id = p_job_id;
    IF v_j.printer_id IS NOT NULL THEN
      UPDATE public.printers SET last_success_at = now(), last_error = NULL, updated_at = now()
      WHERE id = v_j.printer_id;
    END IF;
    IF v_actor IS NOT NULL THEN
      PERFORM public.log_audit_event(v_rest, 'print.job_completed', NULL, v_actor, 'print_job', p_job_id, NULL,
        jsonb_build_object('attempt', v_attempt, 'delivery', v_delivery));
    END IF;
  ELSE
    v_backoff := public.m6_backoff_seconds(v_attempt);
    IF v_attempt >= v_j.max_attempts THEN
      UPDATE public.print_jobs SET
        status = 'failed', attempt_count = v_attempt,
        last_error = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), p_error_code, 'PRINT_FAILED'),
        claimed_by = NULL, claimed_at = NULL, updated_at = now()
      WHERE id = p_job_id;
      IF v_actor IS NOT NULL THEN
        PERFORM public.log_audit_event(v_rest, 'print.job_failed', NULL, v_actor, 'print_job', p_job_id, NULL,
          jsonb_build_object('attempt', v_attempt, 'error', p_error_code));
      END IF;
    ELSE
      UPDATE public.print_jobs SET
        status = 'retry_wait', attempt_count = v_attempt,
        next_attempt_at = now() + make_interval(secs => v_backoff),
        last_error = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), p_error_code, 'PRINT_FAILED'),
        claimed_by = NULL, claimed_at = NULL, updated_at = now()
      WHERE id = p_job_id;
    END IF;
  END IF;

  IF v_j.order_id IS NOT NULL THEN
    PERFORM public.m6_refresh_order_print_status(v_j.order_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.expire_stale_print_jobs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN public.m6_expire_stale_print_jobs(v_rest);
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_print_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_print_settings(int, int, boolean, boolean, int, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_print_bridge_pair_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_print_bridge(text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(text, text, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_print_jobs(uuid, int, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_print_attempt(uuid, boolean, text, text, uuid, text, public.print_delivery) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_print_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_expire_stale_print_jobs(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
