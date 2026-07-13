-- Layout tab: enqueue a preview/test print for receipt or kitchen using the
-- live draft layout + scenario snapshot (no real order required).

CREATE OR REPLACE FUNCTION public.enqueue_layout_preview_print(
  p_document_type text,
  p_layout jsonb,
  p_snapshot jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_kind public.print_job_kind;
  v_role public.printer_role;
  v_printer_id uuid;
  v_printer public.printers%ROWTYPE;
  v_bridge_id uuid;
  v_win text;
  v_ref text;
  v_pj uuid;
  v_settings public.print_settings%ROWTYPE;
  v_snapshot jsonb;
  v_layout jsonb;
  v_payload jsonb;
BEGIN
  IF p_document_type IS DISTINCT FROM 'receipt' AND p_document_type IS DISTINCT FROM 'kitchen' THEN
    RAISE EXCEPTION 'INVALID_KIND';
  END IF;

  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  v_kind := p_document_type::public.print_job_kind;
  v_role := CASE
    WHEN v_kind = 'kitchen' THEN 'kitchen'::public.printer_role
    ELSE 'cashier'::public.printer_role
  END;

  v_printer_id := public.m6_default_printer_for_role(v_rest, v_role);
  IF v_printer_id IS NULL THEN
    RAISE EXCEPTION 'NO_PRINTER';
  END IF;

  SELECT * INTO v_printer FROM public.printers WHERE id = v_printer_id AND restaurant_id = v_rest;
  IF NOT FOUND OR NOT v_printer.is_active THEN
    RAISE EXCEPTION 'NO_PRINTER';
  END IF;

  v_win := nullif(trim(coalesce(v_printer.address->>'windows_printer_name', '')), '');
  IF v_printer.connection = 'windows_spooler' AND v_win IS NULL THEN
    RAISE EXCEPTION 'WINDOWS_PRINTER_REQUIRED';
  END IF;

  IF v_printer.bridge_id IS NOT NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE id = v_printer.bridge_id AND restaurant_id = v_rest AND is_active;
  END IF;
  IF v_bridge_id IS NULL THEN
    SELECT id INTO v_bridge_id FROM public.print_bridges
    WHERE restaurant_id = v_rest AND is_active
    ORDER BY last_heartbeat_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  IF v_bridge_id IS NULL THEN
    RAISE EXCEPTION 'BRIDGE_REQUIRED';
  END IF;

  SELECT * INTO v_settings FROM public.print_settings WHERE restaurant_id = v_rest;

  v_layout := CASE
    WHEN p_layout IS NOT NULL AND jsonb_typeof(p_layout) = 'object' THEN p_layout
    ELSE NULL
  END;

  IF v_layout IS NULL THEN
    SELECT layout INTO v_layout
    FROM public.print_document_layouts
    WHERE restaurant_id = v_rest AND document_type = p_document_type;
  END IF;

  v_snapshot := p_snapshot
    || jsonb_build_object(
      'footer_text', v_printer.footer_text,
      'printer_name', v_printer.name,
      'layout_preview', true,
      'render_style', jsonb_build_object(
        'font_title_pt', coalesce(v_settings.font_title_pt, 28),
        'font_body_pt', coalesce(v_settings.font_body_pt, 17),
        'font_total_pt', coalesce(v_settings.font_total_pt, 24),
        'paper_width_mm', coalesce(
          nullif((v_layout->>'paper_width_mm')::int, 0),
          v_printer.paper_width_mm,
          v_settings.paper_width_mm,
          80
        ),
        'auto_cut', coalesce(v_printer.auto_cut, v_settings.auto_cut, true)
      )
    );

  IF v_layout IS NOT NULL THEN
    v_snapshot := jsonb_set(v_snapshot, '{layout}', v_layout, true);
  END IF;

  v_payload := jsonb_build_object(
    'data_snapshot', v_snapshot,
    'layout_preview', true,
    'document_type', p_document_type
  );
  IF v_win IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('windows_printer_name', v_win);
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (
    restaurant_id, order_id, reference, kind, status, printer_id, bridge_id, payload
  ) VALUES (
    v_rest, NULL, v_ref, v_kind, 'pending', v_printer_id, v_bridge_id, v_payload
  ) RETURNING id INTO v_pj;

  PERFORM public.log_audit_event(
    v_rest, 'print.layout_preview_enqueued', NULL, v_actor, 'print_job', v_pj, NULL,
    jsonb_build_object(
      'document_type', p_document_type,
      'printer_id', v_printer_id,
      'bridge_id', v_bridge_id
    )
  );

  RETURN v_pj;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_layout_preview_print(text, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
