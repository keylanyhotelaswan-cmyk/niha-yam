-- OES polish: shift_handover Bridge print + shift/day collection totals
-- Narrow M6 freeze exception (documented in Final Review): new print_job_kind only.

ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'shift_handover';

ALTER TABLE public.print_document_layouts DROP CONSTRAINT IF EXISTS chk_print_doc_type;
ALTER TABLE public.print_document_layouts
  ADD CONSTRAINT chk_print_doc_type CHECK (
    document_type IN ('receipt', 'kitchen', 'shift_report', 'shift_handover')
  );

-- ---------------------------------------------------------------------------
-- Collection totals by payment method (shift or calendar day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shift_collection_totals(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_by jsonb;
  v_total numeric := 0;
  v_trust numeric := 0;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_order, x.name), '[]'::jsonb)
  INTO v_by
  FROM (
    SELECT
      pm.id AS payment_method_id,
      pm.code,
      pm.name,
      pm.sort_order,
      round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount,
      bool_or(coalesce(t.is_shift_drawer, false) OR pm.code = 'cash') AS counts_toward_handover
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    LEFT JOIN public.treasuries t ON t.id = op.treasury_id
    WHERE o.restaurant_id = v_rest
      AND o.shift_id = p_shift_id
      AND op.collection_status IN ('pending', 'approved')
    GROUP BY pm.id, pm.code, pm.name, pm.sort_order
    HAVING round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) <> 0
  ) x;

  SELECT
    coalesce(sum((e->>'amount')::numeric), 0),
    coalesce(sum(CASE WHEN (e->>'counts_toward_handover')::boolean
      THEN (e->>'amount')::numeric ELSE 0 END), 0)
  INTO v_total, v_trust
  FROM jsonb_array_elements(v_by) e;

  RETURN jsonb_build_object(
    'scope', 'shift',
    'shift_id', p_shift_id,
    'by_payment_method', v_by,
    'total_collected', v_total,
    'trust_cash_total', v_trust
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_day_collection_totals(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_day date := coalesce(p_date, (now() AT TIME ZONE 'Africa/Cairo')::date);
  v_from timestamptz;
  v_to timestamptz;
  v_by jsonb;
  v_total numeric := 0;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_from := (v_day::text || ' 00:00:00')::timestamp AT TIME ZONE 'Africa/Cairo';
  v_to := v_from + interval '1 day';

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sort_order, x.name), '[]'::jsonb)
  INTO v_by
  FROM (
    SELECT
      pm.id AS payment_method_id,
      pm.code,
      pm.name,
      pm.sort_order,
      round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount,
      bool_or(coalesce(t.is_shift_drawer, false) OR pm.code = 'cash') AS counts_toward_handover
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    LEFT JOIN public.treasuries t ON t.id = op.treasury_id
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND op.collection_status IN ('pending', 'approved')
    GROUP BY pm.id, pm.code, pm.name, pm.sort_order
    HAVING round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) <> 0
  ) x;

  SELECT coalesce(sum((e->>'amount')::numeric), 0) INTO v_total
  FROM jsonb_array_elements(v_by) e;

  RETURN jsonb_build_object(
    'scope', 'day',
    'date', v_day,
    'by_payment_method', v_by,
    'total_collected', v_total
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Build handover print snapshot + enqueue to Bridge (cashier printer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_build_handover_print_snapshot(
  p_handover_id uuid,
  p_phase text DEFAULT 'handover'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_h public.shift_handovers%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_cashier text;
  v_receiver text;
  v_coll jsonb;
  v_variance numeric := 0;
  v_title text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_phase NOT IN ('handover', 'receive') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  SELECT * INTO v_h FROM public.shift_handovers WHERE id = p_handover_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_h.shift_id;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_h.created_by;
  SELECT display_name INTO v_receiver FROM public.staff WHERE id = coalesce(v_h.received_by, public.auth_staff_id());

  v_coll := public.get_shift_collection_totals(v_h.shift_id);

  SELECT coalesce(sum(amount), 0) INTO v_variance
  FROM public.treasury_movements
  WHERE shift_id = v_h.shift_id AND source = 'variance';

  v_title := CASE
    WHEN p_phase = 'receive' THEN 'إيصال استلام عهدة'
    ELSE 'إيصال تسليم عهدة'
  END;

  RETURN jsonb_build_object(
    'document_type', 'shift_handover',
    'phase', p_phase,
    'title_ar', v_title,
    'handover_reference', v_h.reference,
    'shift_reference', v_shift.reference,
    'cashier_name', coalesce(v_cashier, ''),
    'received_by_name', coalesce(v_receiver, ''),
    'destination', v_h.kind::text,
    'destination_label_ar', CASE
      WHEN v_h.kind = 'to_main' THEN 'الإدارة / الخزنة الرئيسية'
      ELSE 'الوردية التالية'
    END,
    'trust_amount', v_h.amount,
    'currency_label', 'ج.م',
    'variance', v_variance,
    'actual_cash_count', v_shift.actual_cash_count,
    'printed_at', now(),
    'payment_methods', coalesce(v_coll->'by_payment_method', '[]'::jsonb),
    'total_collected', coalesce((v_coll->>'total_collected')::numeric, 0),
    'trust_note_ar', 'العهدة النقدية فقط — باقي الوسائل للمراجعة'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.m6_enqueue_shift_handover_print(
  p_handover_id uuid,
  p_phase text DEFAULT 'handover'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_h public.shift_handovers%ROWTYPE;
  v_kind public.print_job_kind := 'shift_handover';
  v_printer_id uuid;
  v_printer public.printers%ROWTYPE;
  v_bridge_id uuid;
  v_win text;
  v_ref text;
  v_pj uuid;
  v_settings public.print_settings%ROWTYPE;
  v_snapshot jsonb;
  v_payload jsonb;
  v_paper int := 80;
  v_font_title int := 28;
  v_font_body int := 17;
  v_font_total int := 24;
  v_auto_cut boolean := true;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_phase NOT IN ('handover', 'receive') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  SELECT * INTO v_h FROM public.shift_handovers WHERE id = p_handover_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_printer_id := public.m6_default_printer_for_role(v_rest, 'cashier');
  IF v_printer_id IS NULL THEN RAISE EXCEPTION 'NO_PRINTER'; END IF;

  SELECT * INTO v_printer FROM public.printers WHERE id = v_printer_id AND restaurant_id = v_rest;
  IF NOT FOUND OR NOT v_printer.is_active THEN RAISE EXCEPTION 'NO_PRINTER'; END IF;

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
    ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_bridge_id IS NULL THEN RAISE EXCEPTION 'BRIDGE_REQUIRED'; END IF;

  SELECT * INTO v_settings FROM public.print_settings WHERE restaurant_id = v_rest;
  IF FOUND THEN
    v_font_title := coalesce(v_settings.font_title_pt, v_font_title);
    v_font_body := coalesce(v_settings.font_body_pt, v_font_body);
    v_font_total := coalesce(v_settings.font_total_pt, v_font_total);
    v_paper := coalesce(v_settings.paper_width_mm, v_paper);
    v_auto_cut := coalesce(v_settings.auto_cut, v_auto_cut);
  END IF;
  v_paper := coalesce(v_printer.paper_width_mm, v_paper);
  v_auto_cut := coalesce(v_printer.auto_cut, v_auto_cut);
  IF v_paper NOT IN (58, 80) THEN v_paper := 80; END IF;

  v_snapshot := public.m6_build_handover_print_snapshot(p_handover_id, p_phase)
    || jsonb_build_object(
      'footer_text', v_printer.footer_text,
      'printer_name', v_printer.name,
      'render_style', jsonb_build_object(
        'font_title_pt', v_font_title,
        'font_body_pt', v_font_body,
        'font_total_pt', v_font_total,
        'paper_width_mm', v_paper,
        'auto_cut', v_auto_cut
      )
    );

  v_payload := jsonb_build_object(
    'data_snapshot', v_snapshot,
    'document_type', 'shift_handover',
    'phase', p_phase
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
    v_rest, 'print.test_enqueued', NULL, v_actor, 'print_job', v_pj, NULL,
    jsonb_build_object(
      'document_type', 'shift_handover',
      'phase', p_phase,
      'handover_id', p_handover_id,
      'handover_ref', v_h.reference,
      'printer_id', v_printer_id,
      'bridge_id', v_bridge_id
    )
  );

  RETURN v_pj;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_collection_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_day_collection_totals(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_build_handover_print_snapshot(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_enqueue_shift_handover_print(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
