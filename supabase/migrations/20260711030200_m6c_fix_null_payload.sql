-- Fix: null payload on print_jobs — jsonb_set(NULL) / null footer collapse

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

  -- Ensure settings row exists (VOLATILE context — safe here)
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
    WHERE id = v_printer.bridge_id AND restaurant_id = v_rest AND is_active;
  END IF;
  IF v_bridge_id IS NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE restaurant_id = v_rest AND is_active
    ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
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

  -- Never pass SQL NULL as jsonb_set new_value (collapses whole payload to null)
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

NOTIFY pgrst, 'reload schema';
