-- Dual-environment printing: same Bridge + same printer for Testing and Production.
-- Testing jobs are claim-gated by testing_print_enabled (default OFF on Testing after bootstrap).
-- Production is never gated (is_test_environment = false).

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_ops_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  is_test_environment boolean NOT NULL DEFAULT false,
  testing_print_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

COMMENT ON TABLE public.print_ops_settings IS
  'Per-restaurant print ops flags. is_test_environment is set only on Testing projects.';

INSERT INTO public.print_ops_settings (restaurant_id, is_test_environment, testing_print_enabled)
SELECT r.id, false, true
FROM public.restaurants r
ON CONFLICT (restaurant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.m6_ensure_print_ops_settings(p_restaurant_id uuid)
RETURNS public.print_ops_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.print_ops_settings%ROWTYPE;
BEGIN
  INSERT INTO public.print_ops_settings (restaurant_id)
  VALUES (p_restaurant_id)
  ON CONFLICT (restaurant_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.print_ops_settings
  WHERE restaurant_id = p_restaurant_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.m6_stamp_test_env_payload(
  p_payload jsonb,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_test boolean;
BEGIN
  IF p_payload IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(s.is_test_environment, false) INTO v_is_test
  FROM public.print_ops_settings s
  WHERE s.restaurant_id = p_restaurant_id;

  IF coalesce(v_is_test, false) THEN
    RETURN p_payload || jsonb_build_object(
      'test_env', true,
      'test_env_banner', jsonb_build_array(
        '====================',
        'بيئة اختبار',
        'نسخة اختبار',
        'غير صالحة للتشغيل',
        '===================='
      )
    );
  END IF;

  RETURN p_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_print_ops_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_row public.print_ops_settings%ROWTYPE;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  v_row := public.m6_ensure_print_ops_settings(v_rest);

  RETURN jsonb_build_object(
    'restaurant_id', v_row.restaurant_id,
    'is_test_environment', v_row.is_test_environment,
    'testing_print_enabled', v_row.testing_print_enabled,
    'updated_at', v_row.updated_at
  );
END;
$$;

-- Manager toggle (Testing UI only). Refuses on non-test restaurants.
CREATE OR REPLACE FUNCTION public.set_testing_print_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_row public.print_ops_settings%ROWTYPE;
  v_staff uuid := public.auth_staff_id();
BEGIN
  v_row := public.m6_ensure_print_ops_settings(v_rest);

  IF NOT v_row.is_test_environment THEN
    RAISE EXCEPTION 'NOT_TEST_ENVIRONMENT';
  END IF;

  UPDATE public.print_ops_settings
  SET testing_print_enabled = coalesce(p_enabled, false),
      updated_at = now(),
      updated_by = v_staff
  WHERE restaurant_id = v_rest
  RETURNING * INTO v_row;

  PERFORM public.log_audit_event(
    v_rest, 'print.testing_print_toggled', NULL, v_staff, 'print_ops_settings', v_rest, NULL,
    jsonb_build_object('testing_print_enabled', v_row.testing_print_enabled)
  );

  RETURN jsonb_build_object(
    'restaurant_id', v_row.restaurant_id,
    'is_test_environment', v_row.is_test_environment,
    'testing_print_enabled', v_row.testing_print_enabled,
    'updated_at', v_row.updated_at
  );
END;
$$;

-- Idempotent bootstrap for Testing project (service_role or manager from Testing app).
CREATE OR REPLACE FUNCTION public.m6_bootstrap_test_print_environment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_row public.print_ops_settings%ROWTYPE;
BEGIN
  INSERT INTO public.print_ops_settings (
    restaurant_id, is_test_environment, testing_print_enabled
  ) VALUES (
    v_rest, true, false
  )
  ON CONFLICT (restaurant_id) DO UPDATE
  SET is_test_environment = true,
      -- Keep current toggle if already bootstrapped; only force OFF on first mark.
      testing_print_enabled = CASE
        WHEN public.print_ops_settings.is_test_environment THEN public.print_ops_settings.testing_print_enabled
        ELSE false
      END,
      updated_at = now();

  SELECT * INTO v_row FROM public.print_ops_settings WHERE restaurant_id = v_rest;

  RETURN jsonb_build_object(
    'restaurant_id', v_row.restaurant_id,
    'is_test_environment', v_row.is_test_environment,
    'testing_print_enabled', v_row.testing_print_enabled,
    'updated_at', v_row.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_print_ops_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_testing_print_enabled(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_bootstrap_test_print_environment() TO authenticated;

-- ---------------------------------------------------------------------------
-- claim_print_jobs: gate Testing when toggle is OFF
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
  v_ops public.print_ops_settings%ROWTYPE;
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

  -- Testing env with print disabled: heartbeat/report still work; claim returns empty.
  v_ops := public.m6_ensure_print_ops_settings(v_rest);
  IF v_ops.is_test_environment AND NOT v_ops.testing_print_enabled THEN
    RETURN '[]'::jsonb;
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
-- Stamp test_env on document enqueue
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
  IF NOT FOUND OR NOT v_printer.is_active THEN
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

  v_payload := coalesce(
    public.m6_build_order_print_payload(p_order_id, p_kind),
    jsonb_build_object(
      'order_reference', v_o.reference,
      'kind', p_kind::text,
      'data_snapshot', jsonb_build_object(
        'order_reference', v_o.reference,
        'restaurant_name', 'المطعم',
        'lines', '[]'::jsonb
      )
    )
  );

  v_payload := jsonb_set(
    v_payload,
    '{data_snapshot,footer_text}',
    coalesce(to_jsonb(v_printer.footer_text), 'null'::jsonb),
    true
  );
  v_payload := jsonb_set(
    v_payload,
    '{data_snapshot,printer_name}',
    coalesce(to_jsonb(v_printer.name), '""'::jsonb),
    true
  );

  IF v_win IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('windows_printer_name', v_win);
  END IF;
  IF p_is_reprint THEN
    v_payload := v_payload || jsonb_build_object('reprint', true, 'reason', trim(p_reason));
  END IF;

  v_payload := public.m6_stamp_test_env_payload(v_payload, v_rest);

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'PRINT_PAYLOAD_NULL';
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
-- enqueue_test_print: stamp test_env
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
  v_payload jsonb;
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

  v_payload := public.m6_stamp_test_env_payload(
    jsonb_build_object(
      'test_page', true,
      'printer_name', v_p.name,
      'windows_printer_name', v_win,
      'connection', v_p.connection,
      'printed_at', now(),
      'bridge_version', v_bridge.version
    ),
    v_rest
  );

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, printer_id, bridge_id, payload
  ) VALUES (
    v_rest, NULL, v_ref, 'test_page', 'pending', p_printer_id, v_bridge.id, v_payload
  ) RETURNING id INTO v_pj;

  PERFORM public.log_audit_event(v_rest, 'print.test_enqueued', NULL, v_actor, 'print_job', v_pj, NULL,
    jsonb_build_object('printer_id', p_printer_id, 'bridge_id', v_bridge.id));
  RETURN v_pj;
END; $$;

GRANT EXECUTE ON FUNCTION public.enqueue_test_print(uuid) TO authenticated;

-- Universal stamp for any print_jobs insert (handover, layout preview, future kinds).
CREATE OR REPLACE FUNCTION public.m6_trg_stamp_test_env_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.payload := public.m6_stamp_test_env_payload(NEW.payload, NEW.restaurant_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_print_jobs_stamp_test_env ON public.print_jobs;
CREATE TRIGGER trg_print_jobs_stamp_test_env
  BEFORE INSERT ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.m6_trg_stamp_test_env_job();

-- Diagnostics: clients merge get_print_ops_settings() with diagnose_print_system().
-- Bridge dual-env support starts at 0.5.0 (see apps/print-bridge).

NOTIFY pgrst, 'reload schema';
