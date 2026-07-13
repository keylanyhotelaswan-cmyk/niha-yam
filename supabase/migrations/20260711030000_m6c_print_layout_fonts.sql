-- M6C: Professional ticket payload + Print Center font sizes

ALTER TABLE public.print_settings
  ADD COLUMN IF NOT EXISTS font_title_pt int NOT NULL DEFAULT 26
    CHECK (font_title_pt BETWEEN 14 AND 40),
  ADD COLUMN IF NOT EXISTS font_body_pt int NOT NULL DEFAULT 17
    CHECK (font_body_pt BETWEEN 12 AND 32),
  ADD COLUMN IF NOT EXISTS font_total_pt int NOT NULL DEFAULT 22
    CHECK (font_total_pt BETWEEN 14 AND 40);

-- ---------------------------------------------------------------------------
-- Richer immutable snapshot for Bridge layout
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_build_order_print_payload(
  p_order_id uuid,
  p_kind public.print_job_kind
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_rest_name text;
  v_tz text;
  v_cashier text;
  v_kt_ref text;
  v_lines jsonb;
  v_payments jsonb;
  v_snapshot jsonb;
  v_forbid_prices boolean := (p_kind = 'kitchen');
  v_type_ar text;
  v_change numeric := 0;
  v_thank_you text;
  v_show_qr boolean := false;
  v_font_title int := 26;
  v_font_body int := 17;
  v_font_total int := 22;
  v_paper_w int := 80;
  v_auto_cut boolean := true;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT name, coalesce(nullif(trim(timezone), ''), 'Africa/Cairo')
    INTO v_rest_name, v_tz
  FROM public.restaurants WHERE id = v_o.restaurant_id;

  -- Read-only in STABLE: defaults if settings row missing
  SELECT
    thank_you_message,
    coalesce(show_qr_on_receipt, false),
    coalesce(font_title_pt, 26),
    coalesce(font_body_pt, 17),
    coalesce(font_total_pt, 22),
    coalesce(paper_width_mm, 80),
    coalesce(auto_cut, true)
  INTO
    v_thank_you, v_show_qr, v_font_title, v_font_body, v_font_total, v_paper_w, v_auto_cut
  FROM public.print_settings
  WHERE restaurant_id = v_o.restaurant_id;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_o.created_by;
  SELECT reference INTO v_kt_ref FROM public.kitchen_tickets
  WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1;

  v_type_ar := CASE v_o.order_type::text
    WHEN 'dine_in' THEN 'صالة'
    WHEN 'takeaway' THEN 'استلام'
    WHEN 'delivery' THEN 'دليفري'
    ELSE v_o.order_type::text
  END;

  IF p_kind = 'kitchen' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', oi.name,
      'quantity', oi.quantity,
      'note', oi.line_note,
      'modifiers', (
        SELECT coalesce(jsonb_agg(oim.option_name ORDER BY oim.option_name), '[]'::jsonb)
        FROM public.order_item_modifiers oim WHERE oim.order_item_id = oi.id
      )
    ) ORDER BY oi.sort_order), '[]'::jsonb)
    INTO v_lines
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.needs_kitchen = true;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', oi.name,
      'quantity', oi.quantity,
      'unit_price', oi.unit_price,
      'line_total', oi.line_total,
      'note', oi.line_note,
      'modifiers', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name', oim.option_name, 'price_delta', oim.price_delta
        ) ORDER BY oim.option_name), '[]'::jsonb)
        FROM public.order_item_modifiers oim WHERE oim.order_item_id = oi.id
      )
    ) ORDER BY oi.sort_order), '[]'::jsonb)
    INTO v_lines
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'reference', op.reference,
      'amount', op.amount,
      'net_amount', coalesce(op.net_amount, op.amount - coalesce(op.change_given, 0)),
      'change_given', op.change_given,
      'method', pm.name
    ) ORDER BY op.created_at), '[]'::jsonb),
    coalesce(sum(coalesce(op.change_given, 0)), 0)
    INTO v_payments, v_change
    FROM public.order_payments op
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE op.order_id = p_order_id
      AND op.collection_status IN ('pending', 'approved');
  END IF;

  v_snapshot := jsonb_build_object(
    'order_id', v_o.id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'order_reference', v_o.reference,
    'order_type', v_o.order_type::text,
    'order_type_ar', v_type_ar,
    'datetime', to_char((now() AT TIME ZONE v_tz), 'YYYY-MM-DD HH24:MI'),
    'cashier', v_cashier,
    'order_note', v_o.order_note,
    'customer_name', nullif(trim(coalesce(v_o.delivery_name, '')), ''),
    'customer_phone', nullif(trim(coalesce(v_o.delivery_phone, '')), ''),
    'delivery_address', nullif(trim(coalesce(v_o.delivery_address, '')), ''),
    'table_ref', nullif(trim(coalesce(v_o.dine_in_table_ref, '')), ''),
    'kitchen_ticket', v_kt_ref,
    'lines', coalesce(v_lines, '[]'::jsonb),
    'forbid_prices', v_forbid_prices,
    'thank_you', v_thank_you,
    'show_qr', v_show_qr,
    'render_style', jsonb_build_object(
      'font_title_pt', v_font_title,
      'font_body_pt', v_font_body,
      'font_total_pt', v_font_total,
      'paper_width_mm', v_paper_w,
      'auto_cut', v_auto_cut
    )
  );

  IF NOT v_forbid_prices THEN
    v_snapshot := v_snapshot || jsonb_build_object(
      'subtotal', v_o.subtotal,
      'discount_amount', v_o.discount_amount,
      'total', v_o.total,
      'change_total', v_change,
      'payments', coalesce(v_payments, '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'order_reference', v_o.reference,
    'kind', p_kind::text,
    'data_snapshot', v_snapshot
  );
END; $$;

-- Stamp printer footer/logo onto payload at enqueue
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

  v_payload := public.m6_build_order_print_payload(p_order_id, p_kind);
  -- Attach printer presentation fields into snapshot
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
-- Settings RPCs: expose font sizes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_print_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'thank_you_message', v_row.thank_you_message,
    'font_title_pt', v_row.font_title_pt,
    'font_body_pt', v_row.font_body_pt,
    'font_total_pt', v_row.font_total_pt
  );
END; $$;

DROP FUNCTION IF EXISTS public.upsert_print_settings(int, int, boolean, boolean, int, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.upsert_print_settings(
  p_print_job_ttl_minutes int DEFAULT NULL,
  p_default_copies int DEFAULT NULL,
  p_open_cash_drawer boolean DEFAULT NULL,
  p_auto_cut boolean DEFAULT NULL,
  p_paper_width_mm int DEFAULT NULL,
  p_show_qr_on_receipt boolean DEFAULT NULL,
  p_kitchen_show_prices boolean DEFAULT NULL,
  p_thank_you_message text DEFAULT NULL,
  p_font_title_pt int DEFAULT NULL,
  p_font_body_pt int DEFAULT NULL,
  p_font_total_pt int DEFAULT NULL
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
    font_title_pt = coalesce(p_font_title_pt, font_title_pt),
    font_body_pt = coalesce(p_font_body_pt, font_body_pt),
    font_total_pt = coalesce(p_font_total_pt, font_total_pt),
    updated_at = now()
  WHERE restaurant_id = v_rest;
  RETURN public.get_print_settings();
END; $$;

GRANT EXECUTE ON FUNCTION public.get_print_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_print_settings(
  int, int, boolean, boolean, int, boolean, boolean, text, int, int, int
) TO authenticated;

NOTIFY pgrst, 'reload schema';
