-- M6A: Printing RPCs — registry, queue lifecycle, reprint, health, test print
-- Bridge hardware I/O deferred to M6B; claim/report callable by manager for tests.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_default_printer_for_role(p_rest uuid, p_role public.printer_role)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT printer_id FROM public.print_role_defaults
     WHERE restaurant_id = p_rest AND role = p_role AND printer_id IS NOT NULL),
    (SELECT id FROM public.printers
     WHERE restaurant_id = p_rest AND role = p_role AND is_active = true
     ORDER BY sort_order, name LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.m6_default_template_for_kind(p_rest uuid, p_kind public.print_job_kind)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.print_templates
  WHERE restaurant_id = p_rest AND kind = p_kind AND is_active = true
  ORDER BY version DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.m6_backoff_seconds(p_attempt int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_attempt <= 1 THEN 2
    WHEN p_attempt = 2 THEN 5
    WHEN p_attempt = 3 THEN 15
    WHEN p_attempt = 4 THEN 30
    ELSE 60
  END;
$$;

CREATE OR REPLACE FUNCTION public.m6_refresh_order_print_status(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending int;
  v_failed int;
  v_done int;
  v_total int;
BEGIN
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'claimed', 'printing', 'retry_wait')),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status <> 'cancelled')
  INTO v_pending, v_failed, v_done, v_total
  FROM public.print_jobs
  WHERE order_id = p_order_id;

  IF v_total = 0 THEN
    UPDATE public.orders SET print_status = 'not_needed' WHERE id = p_order_id;
  ELSIF v_failed > 0 AND v_pending = 0 THEN
    UPDATE public.orders SET print_status = 'failed' WHERE id = p_order_id;
  ELSIF v_pending > 0 THEN
    UPDATE public.orders SET print_status = 'pending' WHERE id = p_order_id;
  ELSIF v_done > 0 THEN
    UPDATE public.orders SET print_status = 'done' WHERE id = p_order_id;
  END IF;
END; $$;

-- ---------------------------------------------------------------------------
-- Registry
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
  p_sort_order int DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
BEGIN
  IF length(trim(coalesce(p_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.printers (
      restaurant_id, name, role, device_type, connection, address, paper_width_mm,
      encoding, default_copies, auto_cut, open_cash_drawer, logo_url, footer_text,
      is_active, sort_order
    ) VALUES (
      v_rest, trim(p_name), p_role, coalesce(nullif(trim(p_device_type), ''), 'thermal'),
      p_connection, coalesce(p_address, '{}'::jsonb), coalesce(p_paper_width_mm, 80),
      coalesce(nullif(trim(p_encoding), ''), 'CP864'), coalesce(p_default_copies, 1),
      coalesce(p_auto_cut, true), coalesce(p_open_cash_drawer, false),
      nullif(trim(coalesce(p_logo_url, '')), ''), nullif(trim(coalesce(p_footer_text, '')), ''),
      coalesce(p_is_active, true), coalesce(p_sort_order, 0)
    ) RETURNING id INTO v_id;
    PERFORM public.log_audit_event(v_rest, 'printer.created', NULL, v_actor, 'printer', v_id, NULL,
      jsonb_build_object('name', trim(p_name), 'role', p_role));
  ELSE
    UPDATE public.printers SET
      name = trim(p_name), role = p_role,
      device_type = coalesce(nullif(trim(p_device_type), ''), device_type),
      connection = p_connection, address = coalesce(p_address, address),
      paper_width_mm = coalesce(p_paper_width_mm, paper_width_mm),
      encoding = coalesce(nullif(trim(p_encoding), ''), encoding),
      default_copies = coalesce(p_default_copies, default_copies),
      auto_cut = coalesce(p_auto_cut, auto_cut),
      open_cash_drawer = coalesce(p_open_cash_drawer, open_cash_drawer),
      logo_url = nullif(trim(coalesce(p_logo_url, '')), ''),
      footer_text = nullif(trim(coalesce(p_footer_text, '')), ''),
      is_active = coalesce(p_is_active, is_active),
      sort_order = coalesce(p_sort_order, sort_order),
      updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    PERFORM public.log_audit_event(v_rest, 'printer.updated', NULL, v_actor, 'printer', v_id, NULL,
      jsonb_build_object('name', trim(p_name), 'role', p_role));
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_printer_active(p_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  UPDATE public.printers SET is_active = p_active, updated_at = now()
  WHERE id = p_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.log_audit_event(v_rest, 'printer.status_changed', NULL, public.auth_staff_id(),
    'printer', p_id, NULL, jsonb_build_object('is_active', p_active));
END; $$;

-- ---------------------------------------------------------------------------
-- Templates (read + preview)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_print_templates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'kind', t.kind, 'name', t.name, 'version', t.version,
      'is_active', t.is_active, 'body', t.body
    ) ORDER BY t.kind, t.version DESC)
    FROM public.print_templates t WHERE t.restaurant_id = v_rest
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_print_template(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id(); v_row jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'name', t.name, 'version', t.version,
    'is_active', t.is_active, 'body', t.body
  ) INTO v_row FROM public.print_templates t
  WHERE t.id = p_id AND t.restaurant_id = v_rest;
  IF v_row IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.preview_print_template(p_kind public.print_job_kind)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_tpl public.print_templates%ROWTYPE;
  v_sample jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_tpl FROM public.print_templates
  WHERE restaurant_id = v_rest AND kind = p_kind AND is_active
  ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF p_kind = 'kitchen' THEN
    v_sample := jsonb_build_object(
      'order_reference', 'ORD-000000',
      'order_type', 'takeaway',
      'datetime', to_char(now(), 'YYYY-MM-DD HH24:MI'),
      'cashier', 'معاينة',
      'lines_kitchen', jsonb_build_array(
        jsonb_build_object('name', 'صنف تجريبي', 'qty', 2, 'modifiers', 'حار', 'note', 'بدون بصل')
      ),
      'order_note', 'ملاحظة معاينة',
      'forbid_prices', true
    );
  ELSE
    v_sample := jsonb_build_object(
      'restaurant_name', 'Niha Yam',
      'restaurant_phone', '0000000000',
      'order_reference', 'ORD-000000',
      'datetime', to_char(now(), 'YYYY-MM-DD HH24:MI'),
      'order_type', 'takeaway',
      'customer', 'عميل تجريبي',
      'lines_priced', jsonb_build_array(
        jsonb_build_object('name', 'صنف تجريبي', 'qty', 1, 'price', 50, 'total', 50)
      ),
      'subtotal', 50, 'discount', 0, 'total', 50,
      'payments', jsonb_build_array(jsonb_build_object('method', 'نقدي', 'amount', 50)),
      'change', 0, 'footer', 'شكرًا لزيارتكم'
    );
  END IF;

  RETURN jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id, 'kind', v_tpl.kind, 'name', v_tpl.name,
      'version', v_tpl.version, 'body', v_tpl.body
    ),
    'sample_data', v_sample
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Queue list + summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_print_jobs(
  p_status text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', j.id, 'reference', j.reference, 'order_id', j.order_id,
        'kind', j.kind, 'status', j.status, 'printer_id', j.printer_id,
        'is_reprint', j.is_reprint, 'reprint_reason', j.reprint_reason,
        'attempt_count', j.attempt_count, 'last_error', j.last_error,
        'next_attempt_at', j.next_attempt_at, 'created_at', j.created_at,
        'completed_at', j.completed_at, 'payload', j.payload
      ) AS row, j.created_at
      FROM public.print_jobs j
      WHERE j.restaurant_id = v_rest
        AND (p_status IS NULL OR j.status::text = p_status)
        AND (p_order_id IS NULL OR j.order_id = p_order_id)
      ORDER BY j.created_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) s
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_order_print_summary(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_print_status text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT print_status::text INTO v_print_status
  FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'print_status', v_print_status,
    'jobs_total', (SELECT count(*) FROM public.print_jobs WHERE order_id = p_order_id),
    'jobs_pending', (SELECT count(*) FROM public.print_jobs
      WHERE order_id = p_order_id AND status IN ('pending', 'claimed', 'printing', 'retry_wait')),
    'jobs_failed', (SELECT count(*) FROM public.print_jobs WHERE order_id = p_order_id AND status = 'failed'),
    'jobs_completed', (SELECT count(*) FROM public.print_jobs WHERE order_id = p_order_id AND status = 'completed'),
    'reprint_count', (SELECT count(*) FROM public.print_jobs WHERE order_id = p_order_id AND is_reprint),
    'last_reprint_at', (SELECT max(created_at) FROM public.print_jobs WHERE order_id = p_order_id AND is_reprint)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Claim / report (manager-callable in M6A; Bridge token in M6B)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_print_jobs(
  p_bridge_id uuid,
  p_limit int DEFAULT 10
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
BEGIN
  IF p_bridge_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.print_bridges WHERE id = p_bridge_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  WITH picked AS (
    SELECT j.id
    FROM public.print_jobs j
    WHERE j.restaurant_id = v_rest
      AND (
        j.status = 'pending'
        OR (j.status = 'retry_wait' AND coalesce(j.next_attempt_at, now()) <= now())
      )
    ORDER BY j.created_at
    LIMIT greatest(coalesce(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.print_jobs j
    SET status = 'claimed',
        claimed_by = p_bridge_id,
        claimed_at = now(),
        bridge_id = coalesce(p_bridge_id, j.bridge_id),
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
      'attempt_count', j.attempt_count, 'is_reprint', j.is_reprint
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
  p_bridge_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_j public.print_jobs%ROWTYPE;
  v_attempt int;
  v_backoff int;
BEGIN
  SELECT * INTO v_j FROM public.print_jobs WHERE id = p_job_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_j.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_attempt := v_j.attempt_count + 1;

  INSERT INTO public.print_attempts (
    restaurant_id, print_job_id, bridge_id, attempt_no, status, error_code, error_message, finished_at
  ) VALUES (
    v_rest, p_job_id, coalesce(p_bridge_id, v_j.claimed_by), v_attempt,
    CASE WHEN p_success THEN 'success' ELSE 'failure' END,
    nullif(trim(coalesce(p_error_code, '')), ''),
    nullif(trim(coalesce(p_error_message, '')), ''),
    now()
  );

  IF p_success THEN
    UPDATE public.print_jobs SET
      status = 'completed', attempt_count = v_attempt, last_error = NULL,
      completed_at = now(), claimed_by = NULL, claimed_at = NULL, updated_at = now()
    WHERE id = p_job_id;
    IF v_j.printer_id IS NOT NULL THEN
      UPDATE public.printers SET last_success_at = now(), last_error = NULL, updated_at = now()
      WHERE id = v_j.printer_id;
    END IF;
    PERFORM public.log_audit_event(v_rest, 'print.job_completed', NULL, v_actor, 'print_job', p_job_id, NULL,
      jsonb_build_object('attempt', v_attempt));
  ELSE
    v_backoff := public.m6_backoff_seconds(v_attempt);
    IF v_attempt >= v_j.max_attempts THEN
      UPDATE public.print_jobs SET
        status = 'failed', attempt_count = v_attempt,
        last_error = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), p_error_code, 'PRINT_FAILED'),
        claimed_by = NULL, claimed_at = NULL, updated_at = now()
      WHERE id = p_job_id;
      IF v_j.printer_id IS NOT NULL THEN
        UPDATE public.printers SET last_error = coalesce(p_error_code, p_error_message), updated_at = now()
        WHERE id = v_j.printer_id;
      END IF;
      PERFORM public.log_audit_event(v_rest, 'print.job_failed', NULL, v_actor, 'print_job', p_job_id, NULL,
        jsonb_build_object('attempt', v_attempt, 'error', p_error_code));
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

-- ---------------------------------------------------------------------------
-- Manual queue actions (A5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_print_job(p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_j public.print_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_j FROM public.print_jobs WHERE id = p_job_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_j.status NOT IN ('failed', 'retry_wait', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.print_jobs SET
    status = 'pending', next_attempt_at = NULL, cancel_reason = NULL,
    cancelled_by = NULL, cancelled_at = NULL, claimed_by = NULL, claimed_at = NULL,
    updated_at = now()
  WHERE id = p_job_id;
  PERFORM public.log_audit_event(v_rest, 'print.job_retried', NULL, public.auth_staff_id(),
    'print_job', p_job_id, NULL, NULL);
  IF v_j.order_id IS NOT NULL THEN PERFORM public.m6_refresh_order_print_status(v_j.order_id); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_print_job(p_job_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_j public.print_jobs%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT * INTO v_j FROM public.print_jobs WHERE id = p_job_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_j.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  UPDATE public.print_jobs SET
    status = 'cancelled', cancel_reason = trim(p_reason),
    cancelled_by = v_actor, cancelled_at = now(),
    claimed_by = NULL, claimed_at = NULL, updated_at = now()
  WHERE id = p_job_id;
  PERFORM public.log_audit_event(v_rest, 'print.job_cancelled', NULL, v_actor, 'print_job', p_job_id, NULL,
    jsonb_build_object('reason', trim(p_reason)));
  IF v_j.order_id IS NOT NULL THEN PERFORM public.m6_refresh_order_print_status(v_j.order_id); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.print_job_again(p_job_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_j public.print_jobs%ROWTYPE;
  v_new uuid;
  v_ref text;
BEGIN
  SELECT * INTO v_j FROM public.print_jobs WHERE id = p_job_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_j.status NOT IN ('completed', 'failed', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, payload,
    printer_id, template_id, template_version, is_reprint, reprint_of_job_id
  ) VALUES (
    v_rest, v_j.order_id, v_ref, v_j.kind, 'pending',
    coalesce(v_j.payload, '{}'::jsonb) || jsonb_build_object('print_again', true),
    v_j.printer_id, v_j.template_id, v_j.template_version, true, p_job_id
  ) RETURNING id INTO v_new;

  IF v_j.order_id IS NOT NULL THEN
    PERFORM public.record_order_event(v_j.order_id, 'print.enqueued', 'print_job', v_new,
      jsonb_build_object('kind', v_j.kind::text, 'reference', v_ref, 'print_again', true));
    PERFORM public.m6_refresh_order_print_status(v_j.order_id);
  END IF;
  PERFORM public.log_audit_event(v_rest, 'print.job_again', NULL, v_actor, 'print_job', v_new, NULL,
    jsonb_build_object('from_job', p_job_id));
  RETURN v_new;
END; $$;

-- ---------------------------------------------------------------------------
-- Reprint (reason required)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reprint_order(uuid, public.print_job_kind);

CREATE OR REPLACE FUNCTION public.reprint_order(
  p_order_id uuid,
  p_kind public.print_job_kind DEFAULT 'receipt',
  p_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_ref text;
  v_pj uuid;
  v_ord_ref text;
  v_printer uuid;
  v_tpl uuid;
  v_tpl_ver int;
  v_role public.printer_role;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_kind NOT IN ('receipt', 'kitchen') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  SELECT reference INTO v_ord_ref FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_role := CASE WHEN p_kind = 'kitchen' THEN 'kitchen'::public.printer_role ELSE 'cashier'::public.printer_role END;
  v_printer := public.m6_default_printer_for_role(v_rest, v_role);
  v_tpl := public.m6_default_template_for_kind(v_rest, p_kind);
  SELECT version INTO v_tpl_ver FROM public.print_templates WHERE id = v_tpl;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, payload,
    printer_id, template_id, template_version, is_reprint, reprint_reason
  ) VALUES (
    v_rest, p_order_id, v_ref, p_kind, 'pending',
    jsonb_build_object('order_reference', v_ord_ref, 'reprint', true, 'reason', trim(p_reason)),
    v_printer, v_tpl, v_tpl_ver, true, trim(p_reason)
  ) RETURNING id INTO v_pj;

  PERFORM public.record_order_event(p_order_id, 'print.enqueued', 'print_job', v_pj,
    jsonb_build_object('kind', p_kind::text, 'reference', v_ref, 'reprint', true, 'reason', trim(p_reason)));
  PERFORM public.log_audit_event(v_rest, 'order.reprinted', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('kind', p_kind::text, 'reason', trim(p_reason), 'job_id', v_pj));
  PERFORM public.m6_refresh_order_print_status(p_order_id);
  RETURN v_pj;
END; $$;

-- ---------------------------------------------------------------------------
-- Test print (A2) + health (A6)
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
BEGIN
  SELECT * INTO v_p FROM public.printers WHERE id = p_printer_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT * INTO v_bridge FROM public.print_bridges
  WHERE restaurant_id = v_rest AND is_active ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, printer_id, payload
  ) VALUES (
    v_rest, NULL, v_ref, 'test_page', 'pending', p_printer_id,
    jsonb_build_object(
      'test_page', true,
      'printer_name', v_p.name,
      'connection', v_p.connection,
      'printed_at', now(),
      'bridge_version', v_bridge.version
    )
  ) RETURNING id INTO v_pj;

  PERFORM public.log_audit_event(v_rest, 'print.test_enqueued', NULL, v_actor, 'print_job', v_pj, NULL,
    jsonb_build_object('printer_id', p_printer_id));
  RETURN v_pj;
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_print_bridge_heartbeat(
  p_id uuid,
  p_display_name text DEFAULT NULL,
  p_device_name text DEFAULT NULL,
  p_windows_username text DEFAULT NULL,
  p_version text DEFAULT NULL,
  p_restarted boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.print_bridges (
      restaurant_id, display_name, device_name, windows_username, version,
      last_heartbeat_at, last_connected_at, last_restart_at
    ) VALUES (
      v_rest,
      coalesce(nullif(trim(coalesce(p_display_name, '')), ''), 'Bridge'),
      nullif(trim(coalesce(p_device_name, '')), ''),
      nullif(trim(coalesce(p_windows_username, '')), ''),
      nullif(trim(coalesce(p_version, '')), ''),
      now(), now(), CASE WHEN p_restarted THEN now() ELSE NULL END
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.print_bridges SET
      display_name = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), display_name),
      device_name = coalesce(nullif(trim(coalesce(p_device_name, '')), ''), device_name),
      windows_username = coalesce(nullif(trim(coalesce(p_windows_username, '')), ''), windows_username),
      version = coalesce(nullif(trim(coalesce(p_version, '')), ''), version),
      last_heartbeat_at = now(),
      last_connected_at = now(),
      last_restart_at = CASE WHEN p_restarted THEN now() ELSE last_restart_at END,
      updated_at = now()
    WHERE id = p_id AND restaurant_id = v_rest
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
  PERFORM public.log_audit_event(v_rest, 'print_bridge.heartbeat', NULL, public.auth_staff_id(),
    'print_bridge', v_id, NULL, jsonb_build_object('version', p_version));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_printer_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_bridge jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT jsonb_build_object(
    'id', b.id, 'display_name', b.display_name, 'device_name', b.device_name,
    'windows_username', b.windows_username, 'version', b.version,
    'last_heartbeat_at', b.last_heartbeat_at, 'last_connected_at', b.last_connected_at,
    'last_restart_at', b.last_restart_at,
    'online', (b.last_heartbeat_at IS NOT NULL AND b.last_heartbeat_at > now() - interval '30 seconds')
  ) INTO v_bridge
  FROM public.print_bridges b
  WHERE b.restaurant_id = v_rest AND b.is_active
  ORDER BY b.last_heartbeat_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'bridge', v_bridge,
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
        'last_error', p.last_error,
        'pending_jobs', (SELECT count(*) FROM public.print_jobs j
          WHERE j.printer_id = p.id AND j.status IN ('pending', 'claimed', 'printing', 'retry_wait'))
      ) ORDER BY p.sort_order)
      FROM public.printers p WHERE p.restaurant_id = v_rest
    ), '[]'::jsonb)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.list_printers(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_printer(uuid, text, public.printer_role, text, public.printer_connection, jsonb, int, text, int, boolean, boolean, text, text, boolean, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_printer_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_print_templates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_print_template(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_print_template(public.print_job_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_print_jobs(text, uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_print_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_print_jobs(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_print_attempt(uuid, boolean, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_print_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_print_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.print_job_again(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprint_order(uuid, public.print_job_kind, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_test_print(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_print_bridge_heartbeat(uuid, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_printer_health() TO authenticated;

NOTIFY pgrst, 'reload schema';
