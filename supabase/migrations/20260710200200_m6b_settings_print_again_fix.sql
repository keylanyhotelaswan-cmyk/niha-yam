-- M6B fix: print settings must be VOLATILE (ensure-row INSERT); Print Again allows expired

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
  -- BP-12: expired jobs are recovered only via explicit Print Again
  IF v_j.status NOT IN ('completed', 'failed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

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
    jsonb_build_object('from_job', p_job_id, 'from_status', v_j.status));
  RETURN v_new;
END; $$;
