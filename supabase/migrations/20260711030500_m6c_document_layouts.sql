-- M6C: Per-document-type layout sections (receipt / kitchen; shift_report later)

CREATE TABLE IF NOT EXISTS public.print_document_layouts (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  document_type text NOT NULL
    CONSTRAINT chk_print_doc_type CHECK (document_type IN ('receipt', 'kitchen', 'shift_report')),
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, document_type)
);

ALTER TABLE public.print_document_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS print_document_layouts_select ON public.print_document_layouts;
CREATE POLICY print_document_layouts_select ON public.print_document_layouts
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE OR REPLACE FUNCTION public.m6_default_document_layout(p_document_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_document_type = 'kitchen' THEN
    RETURN jsonb_build_object(
      'version', 1,
      'paper_width_mm', 80,
      'sections', jsonb_build_object(
        'restaurant_name', jsonb_build_object('visible', true, 'font_pt', 26, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2),
        'ticket_header', jsonb_build_object('visible', true, 'font_pt', 18, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2),
        'order_meta', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2),
        'customer_or_table', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2),
        'lines', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2),
        'order_note', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2),
        'thank_you', jsonb_build_object('visible', false, 'font_pt', 16, 'align', 'center', 'bold', false, 'space_before', 2, 'space_after', 2)
      )
    );
  END IF;

  -- receipt (default)
  RETURN jsonb_build_object(
    'version', 1,
    'paper_width_mm', 80,
    'sections', jsonb_build_object(
      'restaurant_name', jsonb_build_object('visible', true, 'font_pt', 30, 'align', 'center', 'bold', true, 'space_before', 0, 'space_after', 2),
      'slogan', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 0, 'space_after', 4),
      'branch_info', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 0, 'space_after', 2),
      'invoice_meta', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'space_before', 0, 'space_after', 2),
      'customer', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'space_before', 0, 'space_after', 2),
      'lines', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'space_before', 2, 'space_after', 2),
      'totals', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'center', 'bold', true, 'space_before', 4, 'space_after', 2),
      'payment', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'space_before', 2, 'space_after', 2),
      'qr', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'center', 'bold', false, 'space_before', 2, 'space_after', 2),
      'thank_you', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', true, 'space_before', 4, 'space_after', 2)
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.m6_ensure_document_layout(p_rest uuid, p_document_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_layout jsonb;
BEGIN
  IF p_document_type NOT IN ('receipt', 'kitchen', 'shift_report') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;
  -- shift_report reserved: seed receipt-like placeholder only when requested later
  IF p_document_type = 'shift_report' THEN
    RAISE EXCEPTION 'NOT_SUPPORTED';
  END IF;

  INSERT INTO public.print_document_layouts (restaurant_id, document_type, layout)
  VALUES (p_rest, p_document_type, public.m6_default_document_layout(p_document_type))
  ON CONFLICT (restaurant_id, document_type) DO NOTHING;

  SELECT layout INTO v_layout
  FROM public.print_document_layouts
  WHERE restaurant_id = p_rest AND document_type = p_document_type;

  RETURN coalesce(v_layout, public.m6_default_document_layout(p_document_type));
END; $$;

-- Seed existing restaurants
INSERT INTO public.print_document_layouts (restaurant_id, document_type, layout)
SELECT r.id, d.doc, public.m6_default_document_layout(d.doc)
FROM public.restaurants r
CROSS JOIN (VALUES ('receipt'), ('kitchen')) AS d(doc)
ON CONFLICT (restaurant_id, document_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_print_document_layout(p_document_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_layout jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_document_type NOT IN ('receipt', 'kitchen') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;
  v_layout := public.m6_ensure_document_layout(v_rest, p_document_type);
  RETURN jsonb_build_object(
    'document_type', p_document_type,
    'layout', v_layout
  );
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_print_document_layout(
  p_document_type text,
  p_layout jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_layout jsonb;
  v_default jsonb;
  v_sections jsonb := '{}'::jsonb;
  v_key text;
  v_sec jsonb;
  v_def jsonb;
  v_paper int;
BEGIN
  IF p_document_type NOT IN ('receipt', 'kitchen') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;

  v_default := public.m6_default_document_layout(p_document_type);
  v_paper := CASE
    WHEN (p_layout->>'paper_width_mm')::int IN (58, 80) THEN (p_layout->>'paper_width_mm')::int
    ELSE coalesce((v_default->>'paper_width_mm')::int, 80)
  END;

  FOR v_key, v_def IN SELECT * FROM jsonb_each(v_default->'sections')
  LOOP
    v_sec := coalesce(p_layout->'sections'->v_key, v_def);
    v_sections := v_sections || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'visible', coalesce((v_sec->>'visible')::boolean, (v_def->>'visible')::boolean, true),
        'font_pt', LEAST(40, GREATEST(10, coalesce((v_sec->>'font_pt')::int, (v_def->>'font_pt')::int, 16))),
        'align', CASE coalesce(v_sec->>'align', v_def->>'align', 'right')
          WHEN 'left' THEN 'left'
          WHEN 'center' THEN 'center'
          ELSE 'right'
        END,
        'bold', coalesce((v_sec->>'bold')::boolean, (v_def->>'bold')::boolean, false),
        'space_before', LEAST(12, GREATEST(0, coalesce((v_sec->>'space_before')::int, (v_def->>'space_before')::int, 0))),
        'space_after', LEAST(12, GREATEST(0, coalesce((v_sec->>'space_after')::int, (v_def->>'space_after')::int, 2)))
      )
    );
  END LOOP;

  v_layout := jsonb_build_object(
    'version', 1,
    'paper_width_mm', v_paper,
    'sections', v_sections
  );

  INSERT INTO public.print_document_layouts (restaurant_id, document_type, layout, updated_at)
  VALUES (v_rest, p_document_type, v_layout, now())
  ON CONFLICT (restaurant_id, document_type) DO UPDATE SET
    layout = excluded.layout,
    updated_at = now();

  RETURN public.get_print_document_layout(p_document_type);
END; $$;

CREATE OR REPLACE FUNCTION public.preview_print_document(p_document_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_layout jsonb;
  v_ps public.print_settings%ROWTYPE;
  v_rest_name text;
  v_snap jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_document_type NOT IN ('receipt', 'kitchen') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE';
  END IF;

  v_layout := public.m6_ensure_document_layout(v_rest, p_document_type);
  INSERT INTO public.print_settings (restaurant_id) VALUES (v_rest)
  ON CONFLICT (restaurant_id) DO NOTHING;
  SELECT * INTO v_ps FROM public.print_settings WHERE restaurant_id = v_rest;
  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_rest;

  IF p_document_type = 'kitchen' THEN
    v_snap := jsonb_build_object(
      'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
      'order_reference', 'ORD-000042',
      'order_type_ar', 'صالة',
      'datetime', to_char(now() AT TIME ZONE coalesce(
        (SELECT timezone FROM public.restaurants WHERE id = v_rest), 'Africa/Cairo'
      ), 'YYYY/MM/DD HH12:MI:SS') || ' م',
      'cashier', 'معاينة',
      'table_ref', '5',
      'customer_name', 'اختبار',
      'kitchen_ticket', 'KT-000012',
      'order_note', 'بدون بصل',
      'lines', jsonb_build_array(
        jsonb_build_object('name', 'ترياكي', 'quantity', 2, 'modifiers', jsonb_build_array('حار'), 'note', null),
        jsonb_build_object('name', 'بطاطس', 'quantity', 1, 'modifiers', '[]'::jsonb, 'note', null)
      ),
      'thank_you', coalesce(v_ps.thank_you_message, 'شكراً لزيارتكم'),
      'show_qr', false,
      'layout', v_layout
    );
  ELSE
    v_snap := jsonb_build_object(
      'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
      'slogan', v_ps.receipt_slogan,
      'restaurant_phone', v_ps.restaurant_phone,
      'restaurant_address', v_ps.restaurant_address,
      'currency_label', CASE upper(coalesce((SELECT currency_code FROM public.restaurants WHERE id = v_rest), ''))
        WHEN 'EGP' THEN 'ج.م' WHEN 'SAR' THEN 'ر.س' WHEN 'AED' THEN 'د.إ' ELSE coalesce((SELECT currency_code FROM public.restaurants WHERE id = v_rest), '')
      END,
      'order_reference', 'ORD-000042',
      'invoice_label', 'فاتورة #ORD-000042',
      'order_type_ar', 'استلام',
      'datetime', to_char(now() AT TIME ZONE coalesce(
        (SELECT timezone FROM public.restaurants WHERE id = v_rest), 'Africa/Cairo'
      ), 'YYYY/MM/DD HH12:MI:SS') || ' م',
      'cashier', 'معاينة',
      'customer_name', 'اختبار',
      'payment_status_ar', 'مدفوع',
      'payment_method', 'نقدي',
      'lines', jsonb_build_array(
        jsonb_build_object('name', 'ترياكي', 'quantity', 1, 'unit_price', 20, 'line_total', 20,
          'modifiers', '[]'::jsonb, 'note', null)
      ),
      'subtotal', 20, 'discount_amount', 0, 'total', 20, 'change_total', 0,
      'payments', jsonb_build_array(jsonb_build_object('method', 'نقدي', 'amount', 20, 'net_amount', 20)),
      'thank_you', coalesce(v_ps.thank_you_message, 'شكراً لزيارتكم'),
      'show_qr', coalesce(v_ps.show_qr_on_receipt, false),
      'layout', v_layout
    );
  END IF;

  RETURN jsonb_build_object(
    'document_type', p_document_type,
    'layout', v_layout,
    'sample_snapshot', v_snap
  );
END; $$;

-- Embed layout into order print payload
CREATE OR REPLACE FUNCTION public.m6_build_order_print_payload(
  p_order_id uuid,
  p_kind public.print_job_kind
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_rest_name text;
  v_currency text;
  v_currency_label text;
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
  v_slogan text;
  v_rest_phone text;
  v_rest_address text;
  v_show_qr boolean := false;
  v_font_title int := 28;
  v_font_body int := 17;
  v_font_total int := 22;
  v_paper_w int := 80;
  v_auto_cut boolean := true;
  v_pay_status_ar text;
  v_pay_method text;
  v_local_ts timestamp;
  v_dt text;
  v_doc_type text;
  v_layout jsonb;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT
    name,
    currency_code,
    coalesce(nullif(trim(timezone), ''), 'Africa/Cairo')
  INTO v_rest_name, v_currency, v_tz
  FROM public.restaurants WHERE id = v_o.restaurant_id;

  v_currency_label := CASE upper(coalesce(v_currency, ''))
    WHEN 'EGP' THEN 'ج.م'
    WHEN 'SAR' THEN 'ر.س'
    WHEN 'AED' THEN 'د.إ'
    WHEN 'USD' THEN '$'
    ELSE coalesce(nullif(trim(v_currency), ''), '')
  END;

  SELECT
    coalesce(nullif(trim(thank_you_message), ''), 'شكراً لزيارتكم'),
    nullif(trim(receipt_slogan), ''),
    nullif(trim(restaurant_phone), ''),
    nullif(trim(restaurant_address), ''),
    coalesce(show_qr_on_receipt, false),
    coalesce(font_title_pt, 28),
    coalesce(font_body_pt, 17),
    coalesce(font_total_pt, 22),
    coalesce(paper_width_mm, 80),
    coalesce(auto_cut, true)
  INTO
    v_thank_you, v_slogan, v_rest_phone, v_rest_address,
    v_show_qr, v_font_title, v_font_body, v_font_total, v_paper_w, v_auto_cut
  FROM public.print_settings
  WHERE restaurant_id = v_o.restaurant_id;

  v_doc_type := CASE WHEN p_kind = 'kitchen' THEN 'kitchen' ELSE 'receipt' END;
  -- STABLE: read only — no ensure INSERT here
  SELECT layout INTO v_layout
  FROM public.print_document_layouts
  WHERE restaurant_id = v_o.restaurant_id AND document_type = v_doc_type;
  v_layout := coalesce(v_layout, public.m6_default_document_layout(v_doc_type));
  -- Prefer layout paper width when present
  IF (v_layout->>'paper_width_mm')::int IN (58, 80) THEN
    v_paper_w := (v_layout->>'paper_width_mm')::int;
  END IF;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_o.created_by;
  SELECT reference INTO v_kt_ref FROM public.kitchen_tickets
  WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1;

  v_type_ar := CASE v_o.order_type::text
    WHEN 'dine_in' THEN 'صالة'
    WHEN 'takeaway' THEN 'استلام'
    WHEN 'delivery' THEN 'دليفري'
    ELSE v_o.order_type::text
  END;

  v_pay_status_ar := CASE v_o.payment_status::text
    WHEN 'paid' THEN 'مدفوع'
    WHEN 'partial' THEN 'جزئي'
    WHEN 'unpaid' THEN 'غير مدفوع'
    ELSE v_o.payment_status::text
  END;

  v_local_ts := (coalesce(v_o.created_at, now()) AT TIME ZONE v_tz);
  v_dt := to_char(v_local_ts, 'YYYY/MM/DD HH12:MI:SS')
    || CASE WHEN extract(hour from v_local_ts) < 12 THEN ' ص' ELSE ' م' END;

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

    SELECT pm.name INTO v_pay_method
    FROM public.order_payments op
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE op.order_id = p_order_id
      AND op.collection_status IN ('pending', 'approved')
    ORDER BY op.created_at DESC
    LIMIT 1;
  END IF;

  v_snapshot := jsonb_build_object(
    'order_id', v_o.id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'slogan', v_slogan,
    'restaurant_phone', v_rest_phone,
    'restaurant_address', v_rest_address,
    'currency_code', v_currency,
    'currency_label', v_currency_label,
    'order_reference', v_o.reference,
    'invoice_label', 'فاتورة #' || coalesce(v_o.reference, ''),
    'order_type', v_o.order_type::text,
    'order_type_ar', v_type_ar,
    'datetime', v_dt,
    'cashier', v_cashier,
    'order_note', v_o.order_note,
    'customer_name', nullif(trim(coalesce(v_o.delivery_name, '')), ''),
    'customer_phone', nullif(trim(coalesce(v_o.delivery_phone, '')), ''),
    'delivery_address', nullif(trim(coalesce(v_o.delivery_address, '')), ''),
    'table_ref', nullif(trim(coalesce(v_o.dine_in_table_ref, '')), ''),
    'kitchen_ticket', v_kt_ref,
    'payment_status', v_o.payment_status::text,
    'payment_status_ar', v_pay_status_ar,
    'payment_method', v_pay_method,
    'lines', coalesce(v_lines, '[]'::jsonb),
    'forbid_prices', v_forbid_prices,
    'thank_you', v_thank_you,
    'show_qr', v_show_qr,
    'layout', v_layout,
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

GRANT EXECUTE ON FUNCTION public.get_print_document_layout(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_print_document_layout(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_print_document(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
