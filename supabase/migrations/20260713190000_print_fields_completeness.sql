-- Print Fields Completeness: restore WYSIWYG layout embed + expand order print snapshot
-- Handover / ops_message remain Bridge-hardcoded (no designer).

CREATE OR REPLACE FUNCTION public.m6_fmt_local_ts(p_ts timestamptz, p_tz text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_ts IS NULL THEN NULL
    ELSE to_char((p_ts AT TIME ZONE coalesce(nullif(trim(p_tz), ''), 'Africa/Cairo')), 'YYYY/MM/DD HH24:MI')
  END;
$$;

CREATE OR REPLACE FUNCTION public.m6_build_order_print_payload(
  p_order_id uuid,
  p_kind public.print_job_kind
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_rest_name text;
  v_currency text;
  v_currency_label text;
  v_tz text;
  v_created_by text;
  v_edited_by text;
  v_collected_by text;
  v_collected_at timestamptz;
  v_driver_name text;
  v_shift_ref text;
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
  v_printed_at timestamptz := now();
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
  SELECT layout INTO v_layout
  FROM public.print_document_layouts
  WHERE restaurant_id = v_o.restaurant_id AND document_type = v_doc_type;
  v_layout := coalesce(v_layout, public.m6_default_document_layout(v_doc_type));
  IF (v_layout->>'paper_width_mm')::int IN (58, 80) THEN
    v_paper_w := (v_layout->>'paper_width_mm')::int;
  END IF;

  SELECT display_name INTO v_created_by FROM public.staff WHERE id = v_o.created_by;
  SELECT display_name INTO v_edited_by FROM public.staff WHERE id = v_o.last_edited_by;

  SELECT cs.display_name, op.created_at
  INTO v_collected_by, v_collected_at
  FROM public.order_payments op
  LEFT JOIN public.staff cs ON cs.id = op.created_by
  WHERE op.order_id = p_order_id
    AND op.collection_status IN ('pending', 'approved')
  ORDER BY op.created_at DESC
  LIMIT 1;

  SELECT display_name INTO v_driver_name
  FROM public.delivery_drivers
  WHERE id = v_o.delivery_driver_id;

  SELECT reference INTO v_shift_ref
  FROM public.shifts WHERE id = v_o.shift_id;

  SELECT reference INTO v_kt_ref
  FROM public.kitchen_tickets
  WHERE order_id = p_order_id
  ORDER BY created_at DESC
  LIMIT 1;

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
    'branch_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'slogan', v_slogan,
    'restaurant_phone', v_rest_phone,
    'restaurant_address', v_rest_address,
    'currency_code', v_currency,
    'currency_label', v_currency_label,
    'order_reference', v_o.reference,
    'invoice_label', 'فاتورة #' || coalesce(v_o.reference, ''),
    'order_type', v_o.order_type::text,
    'order_type_ar', v_type_ar,
    -- legacy aliases (Bridge/old templates)
    'datetime', public.m6_fmt_local_ts(v_printed_at, v_tz),
    'cashier', v_created_by,
    -- identity
    'created_by_name', coalesce(v_created_by, ''),
    'last_edited_by_name', nullif(trim(coalesce(v_edited_by, '')), ''),
    'collected_by_name', nullif(trim(coalesce(v_collected_by, '')), ''),
    'created_at', public.m6_fmt_local_ts(v_o.created_at, v_tz),
    'last_edited_at', public.m6_fmt_local_ts(v_o.last_edited_at, v_tz),
    'collected_at', public.m6_fmt_local_ts(v_collected_at, v_tz),
    'printed_at', public.m6_fmt_local_ts(v_printed_at, v_tz),
    -- customer
    'customer_name', nullif(trim(coalesce(v_o.delivery_name, '')), ''),
    'customer_phone', nullif(trim(coalesce(v_o.delivery_phone, '')), ''),
    'delivery_zone', nullif(trim(coalesce(v_o.delivery_zone, '')), ''),
    'delivery_address', nullif(trim(coalesce(v_o.delivery_address, '')), ''),
    'delivery_notes', nullif(trim(coalesce(v_o.delivery_notes, '')), ''),
    'driver_name', nullif(trim(coalesce(v_driver_name, '')), ''),
    'table_ref', nullif(trim(coalesce(v_o.dine_in_table_ref, '')), ''),
    -- ops
    'shift_reference', nullif(trim(coalesce(v_shift_ref, '')), ''),
    'device_name', NULL,
    'kitchen_ticket', v_kt_ref,
    'order_note', v_o.order_note,
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
END;
$$;

CREATE OR REPLACE FUNCTION public.m6_ensure_layout_field(
  p_layout jsonb,
  p_section text,
  p_field text,
  p_default jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF (p_layout #> ARRAY['sections', p_section]) IS NULL THEN
    RETURN p_layout;
  END IF;
  IF (p_layout #> ARRAY['sections', p_section, 'fields', p_field]) IS NOT NULL THEN
    RETURN p_layout;
  END IF;
  IF (p_layout #> ARRAY['sections', p_section, 'fields']) IS NULL THEN
    RETURN jsonb_set(
      p_layout,
      ARRAY['sections', p_section, 'fields'],
      jsonb_build_object(p_field, p_default),
      true
    );
  END IF;
  RETURN jsonb_set(
    p_layout,
    ARRAY['sections', p_section, 'fields', p_field],
    p_default,
    true
  );
END;
$$;

-- Expand stored layouts: rename cashier→created_by_name, datetime→printed_at, add new fields
CREATE OR REPLACE FUNCTION public.m6_migrate_layout_fields_v3(p_layout jsonb, p_document_type text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb := p_layout;
  v_sec text;
  v_old jsonb;
  v_fields jsonb;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
    RETURN public.m6_default_document_layout(p_document_type);
  END IF;

  FOREACH v_sec IN ARRAY ARRAY['invoice_meta', 'order_meta']
  LOOP
    IF (v #> ARRAY['sections', v_sec, 'fields']) IS NULL THEN
      CONTINUE;
    END IF;
    v_fields := v #> ARRAY['sections', v_sec, 'fields'];

    -- cashier → created_by_name
    IF (v_fields ? 'cashier') AND NOT (v_fields ? 'created_by_name') THEN
      v_old := v_fields->'cashier';
      IF (v_old->>'label_ar') IN ('كاشير', 'الكاشير', 'Cashier') OR coalesce(v_old->>'label_ar', '') = '' THEN
        v_old := v_old || jsonb_build_object('label_ar', 'أنشأ الطلب', 'label_en', 'Created by');
      END IF;
      v_fields := (v_fields - 'cashier') || jsonb_build_object('created_by_name', v_old);
    ELSIF (v_fields ? 'cashier') THEN
      v_fields := v_fields - 'cashier';
    END IF;

    -- datetime → printed_at (keep visible preference)
    IF (v_fields ? 'datetime') AND NOT (v_fields ? 'printed_at') THEN
      v_old := v_fields->'datetime';
      IF coalesce(v_old->>'label_ar', '') = '' THEN
        v_old := v_old || jsonb_build_object('label_ar', 'وقت الطباعة', 'label_en', 'Printed at');
      END IF;
      v_fields := (v_fields - 'datetime') || jsonb_build_object('printed_at', v_old);
    ELSIF (v_fields ? 'datetime') THEN
      v_fields := v_fields - 'datetime';
    END IF;

    v := jsonb_set(v, ARRAY['sections', v_sec, 'fields'], v_fields, true);
  END LOOP;

  -- Helper to add field if missing
  IF p_document_type = 'receipt' THEN
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'order_reference',
      jsonb_build_object('visible', false, 'font_pt', 16, 'align', 'right', 'bold', true,
        'label_ar', 'رقم الطلب', 'label_en', 'Order', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'created_at',
      jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false,
        'label_ar', 'وقت الإنشاء', 'label_en', 'Created at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'last_edited_at',
      jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false,
        'label_ar', 'وقت آخر تعديل', 'label_en', 'Last edited at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'collected_at',
      jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false,
        'label_ar', 'وقت التحصيل', 'label_en', 'Collected at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'printed_at',
      jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false,
        'label_ar', 'وقت الطباعة', 'label_en', 'Printed at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'created_by_name',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'أنشأ الطلب', 'label_en', 'Created by', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'last_edited_by_name',
      jsonb_build_object('visible', false, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'آخر تعديل بواسطة', 'label_en', 'Last edited by', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'collected_by_name',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'تم التحصيل بواسطة', 'label_en', 'Collected by', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'invoice_meta', 'order_type',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'نوع الطلب', 'label_en', 'Order type', 'label_mode', 'ar'));

    v := public.m6_ensure_layout_field(v, 'customer', 'delivery_zone',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'المنطقة', 'label_en', 'Zone', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer', 'delivery_notes',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'ملاحظات التوصيل', 'label_en', 'Delivery notes', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer', 'driver_name',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'المندوب', 'label_en', 'Driver', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer', 'customer_phone',
      jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'label_ar', 'هاتف العميل', 'label_en', 'Customer phone', 'label_mode', 'ar'));

    -- ops section
    IF (v #> '{sections,ops}') IS NULL THEN
      v := jsonb_set(v, '{sections,ops}', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'right', 'bold', false,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'shift_reference', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false,
            'label_ar', 'رقم الوردية', 'label_en', 'Shift', 'label_mode', 'ar'),
          'branch_name', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false,
            'label_ar', 'الفرع', 'label_en', 'Branch', 'label_mode', 'ar'),
          'device_name', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false,
            'label_ar', 'الجهاز', 'label_en', 'Device', 'label_mode', 'ar')
        )
      ), true);
      IF jsonb_typeof(v->'section_order') = 'array'
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v->'section_order') AS x(id) WHERE x.id = 'ops'
         ) THEN
        v := jsonb_set(v, '{section_order}', (v->'section_order') || '"ops"'::jsonb, true);
      END IF;
    END IF;

    v := public.m6_ensure_layout_field(v, 'payment', 'payment_lines',
      jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', true,
        'label_ar', 'وسائل الدفع', 'label_en', 'Payments', 'label_mode', 'ar'));
    -- Prefer detailed lines: hide single method by default on migrate if payment_lines added fresh
    IF (v #> '{sections,payment,fields,method,visible}') IS NOT NULL
       AND (v #>> '{sections,payment,fields,payment_lines,visible}') = 'true' THEN
      -- leave existing method visibility; new installs hide method via default layout
      NULL;
    END IF;

    -- Refresh misleading labels if still old
    IF (v #>> '{sections,invoice_meta,fields,order_type,label_ar}') IN ('النوع', 'Type') THEN
      v := jsonb_set(v, '{sections,invoice_meta,fields,order_type,label_ar}', '"نوع الطلب"', true);
    END IF;
    IF (v #>> '{sections,customer,fields,customer_phone,label_ar}') IN ('هاتف', 'Phone') THEN
      v := jsonb_set(v, '{sections,customer,fields,customer_phone,label_ar}', '"هاتف العميل"', true);
    END IF;
  END IF;

  IF p_document_type = 'kitchen' THEN
    v := public.m6_ensure_layout_field(v, 'order_meta', 'created_at',
      jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', false,
        'label_ar', 'وقت الإنشاء', 'label_en', 'Created at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'order_meta', 'printed_at',
      jsonb_build_object('visible', false, 'font_pt', 15, 'align', 'right', 'bold', false,
        'label_ar', 'وقت الطباعة', 'label_en', 'Printed at', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'order_meta', 'created_by_name',
      jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'أنشأ الطلب', 'label_en', 'Created by', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'order_meta', 'order_type',
      jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'نوع الطلب', 'label_en', 'Order type', 'label_mode', 'ar'));

    v := public.m6_ensure_layout_field(v, 'customer_or_table', 'customer_phone',
      jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'هاتف العميل', 'label_en', 'Customer phone', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer_or_table', 'delivery_zone',
      jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'المنطقة', 'label_en', 'Zone', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer_or_table', 'delivery_address',
      jsonb_build_object('visible', false, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'العنوان', 'label_en', 'Address', 'label_mode', 'ar'));
    v := public.m6_ensure_layout_field(v, 'customer_or_table', 'driver_name',
      jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false,
        'label_ar', 'المندوب', 'label_en', 'Driver', 'label_mode', 'ar'));

    IF (v #>> '{sections,order_meta,fields,order_type,label_ar}') IN ('النوع', 'Type') THEN
      v := jsonb_set(v, '{sections,order_meta,fields,order_type,label_ar}', '"نوع الطلب"', true);
    END IF;
  END IF;

  RETURN v;
END;
$$;

-- Rebuild default layouts (receipt/kitchen) with full field set
CREATE OR REPLACE FUNCTION public.m6_default_document_layout(p_document_type text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_document_type = 'kitchen' THEN
    RETURN jsonb_build_object(
      'version', 2,
      'paper_width_mm', 80,
      'section_order', jsonb_build_array(
        'restaurant_name', 'ticket_header', 'order_meta', 'customer_or_table',
        'lines', 'order_note', 'thank_you'
      ),
      'sections', jsonb_build_object(
        'restaurant_name', jsonb_build_object(
          'visible', true, 'font_pt', 26, 'align', 'center', 'bold', true,
          'space_before', 0, 'space_after', 2,
          'fields', jsonb_build_object(
            'name', jsonb_build_object('visible', true, 'font_pt', 26, 'align', 'center', 'bold', true, 'label_ar', '', 'label_mode', 'ar')
          )
        ),
        'ticket_header', jsonb_build_object(
          'visible', true, 'font_pt', 18, 'align', 'center', 'bold', true,
          'space_before', 0, 'space_after', 2,
          'fields', jsonb_build_object(
            'title', jsonb_build_object('visible', true, 'font_pt', 18, 'align', 'center', 'bold', true,
              'label_ar', 'تذكرة مطبخ', 'label_en', 'Kitchen Ticket', 'label_mode', 'ar')
          )
        ),
        'order_meta', jsonb_build_object(
          'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true,
          'space_before', 0, 'space_after', 2,
          'fields', jsonb_build_object(
            'order_reference', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'رقم الطلب', 'label_en', 'Order', 'label_mode', 'ar'),
            'kitchen_ticket', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'تذكرة', 'label_en', 'Ticket', 'label_mode', 'ar'),
            'order_type', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'نوع الطلب', 'label_en', 'Order type', 'label_mode', 'ar'),
            'created_by_name', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'أنشأ الطلب', 'label_en', 'Created by', 'label_mode', 'ar'),
            'created_at', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', false, 'label_ar', 'وقت الإنشاء', 'label_en', 'Created at', 'label_mode', 'ar'),
            'printed_at', jsonb_build_object('visible', false, 'font_pt', 15, 'align', 'right', 'bold', false, 'label_ar', 'وقت الطباعة', 'label_en', 'Printed at', 'label_mode', 'ar')
          )
        ),
        'customer_or_table', jsonb_build_object(
          'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true,
          'space_before', 0, 'space_after', 2,
          'fields', jsonb_build_object(
            'table_ref', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'الطاولة', 'label_en', 'Table', 'label_mode', 'ar'),
            'customer_name', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'العميل', 'label_en', 'Customer', 'label_mode', 'ar'),
            'customer_phone', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'هاتف العميل', 'label_en', 'Customer phone', 'label_mode', 'ar'),
            'delivery_zone', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'المنطقة', 'label_en', 'Zone', 'label_mode', 'ar'),
            'delivery_address', jsonb_build_object('visible', false, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'العنوان', 'label_en', 'Address', 'label_mode', 'ar'),
            'driver_name', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', false, 'label_ar', 'المندوب', 'label_en', 'Driver', 'label_mode', 'ar')
          )
        ),
        'lines', jsonb_build_object(
          'visible', true, 'font_pt', 22, 'align', 'right', 'bold', true,
          'space_before', 2, 'space_after', 2,
          'fields', jsonb_build_object(
            'item_line', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'right', 'bold', true, 'label_ar', '', 'label_mode', 'ar'),
            'modifiers', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar'),
            'note', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar')
          )
        ),
        'order_note', jsonb_build_object(
          'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true,
          'space_before', 2, 'space_after', 2,
          'fields', jsonb_build_object(
            'note', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', 'ملاحظة', 'label_en', 'Note', 'label_mode', 'ar')
          )
        ),
        'thank_you', jsonb_build_object(
          'visible', true, 'font_pt', 16, 'align', 'center', 'bold', true,
          'space_before', 2, 'space_after', 4,
          'fields', jsonb_build_object(
            'message', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', true, 'label_ar', '', 'label_mode', 'ar')
          )
        )
      )
    );
  END IF;

  -- receipt
  RETURN jsonb_build_object(
    'version', 2,
    'paper_width_mm', 80,
    'section_order', jsonb_build_array(
      'restaurant_name', 'slogan', 'branch_info', 'invoice_meta', 'customer',
      'lines', 'totals', 'payment', 'ops', 'qr', 'thank_you'
    ),
    'sections', jsonb_build_object(
      'restaurant_name', jsonb_build_object(
        'visible', true, 'font_pt', 30, 'align', 'center', 'bold', true,
        'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'name', jsonb_build_object('visible', true, 'font_pt', 30, 'align', 'center', 'bold', true, 'label_ar', '', 'label_mode', 'ar')
        )
      ),
      'slogan', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'center', 'bold', false,
        'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'text', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'label_ar', '', 'label_mode', 'ar')
        )
      ),
      'branch_info', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'center', 'bold', false,
        'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'address', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'label_ar', '', 'label_mode', 'ar'),
          'phone', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', true, 'label_ar', '', 'label_mode', 'ar')
        )
      ),
      'invoice_meta', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'right', 'bold', true,
        'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'invoice_number', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'label_ar', 'رقم الفاتورة', 'label_en', 'Invoice', 'label_mode', 'ar'),
          'order_reference', jsonb_build_object('visible', false, 'font_pt', 16, 'align', 'right', 'bold', true, 'label_ar', 'رقم الطلب', 'label_en', 'Order', 'label_mode', 'ar'),
          'order_type', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'نوع الطلب', 'label_en', 'Order type', 'label_mode', 'ar'),
          'created_by_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'أنشأ الطلب', 'label_en', 'Created by', 'label_mode', 'ar'),
          'last_edited_by_name', jsonb_build_object('visible', false, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'آخر تعديل بواسطة', 'label_en', 'Last edited by', 'label_mode', 'ar'),
          'collected_by_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'تم التحصيل بواسطة', 'label_en', 'Collected by', 'label_mode', 'ar'),
          'created_at', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'وقت الإنشاء', 'label_en', 'Created at', 'label_mode', 'ar'),
          'last_edited_at', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'وقت آخر تعديل', 'label_en', 'Last edited at', 'label_mode', 'ar'),
          'collected_at', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'وقت التحصيل', 'label_en', 'Collected at', 'label_mode', 'ar'),
          'printed_at', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'وقت الطباعة', 'label_en', 'Printed at', 'label_mode', 'ar')
        )
      ),
      'customer', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'right', 'bold', false,
        'space_before', 0, 'space_after', 2,
        'fields', jsonb_build_object(
          'customer_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'العميل', 'label_en', 'Customer', 'label_mode', 'ar'),
          'customer_phone', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'هاتف العميل', 'label_en', 'Customer phone', 'label_mode', 'ar'),
          'delivery_zone', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'المنطقة', 'label_en', 'Zone', 'label_mode', 'ar'),
          'delivery_address', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'العنوان', 'label_en', 'Address', 'label_mode', 'ar'),
          'delivery_notes', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'ملاحظات التوصيل', 'label_en', 'Delivery notes', 'label_mode', 'ar'),
          'driver_name', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', false, 'label_ar', 'المندوب', 'label_en', 'Driver', 'label_mode', 'ar'),
          'table_ref', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'right', 'bold', true, 'label_ar', 'الطاولة', 'label_en', 'Table', 'label_mode', 'ar')
        )
      ),
      'lines', jsonb_build_object(
        'visible', true, 'font_pt', 17, 'align', 'right', 'bold', true,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'item_line', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', '', 'label_mode', 'ar'),
          'price', jsonb_build_object('visible', true, 'font_pt', 17, 'align', 'right', 'bold', true, 'label_ar', '', 'label_mode', 'ar'),
          'modifiers', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar'),
          'note', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', '', 'label_mode', 'ar')
        )
      ),
      'totals', jsonb_build_object(
        'visible', true, 'font_pt', 22, 'align', 'center', 'bold', true,
        'space_before', 4, 'space_after', 2,
        'fields', jsonb_build_object(
          'subtotal', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'المجموع', 'label_en', 'Subtotal', 'label_mode', 'ar'),
          'discount', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'الخصم', 'label_en', 'Discount', 'label_mode', 'ar'),
          'tax', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', false, 'label_ar', 'الضريبة', 'label_en', 'Tax', 'label_mode', 'ar'),
          'total', jsonb_build_object('visible', true, 'font_pt', 22, 'align', 'center', 'bold', true, 'label_ar', 'الإجمالي', 'label_en', 'Total', 'label_mode', 'ar')
        )
      ),
      'payment', jsonb_build_object(
        'visible', true, 'font_pt', 15, 'align', 'right', 'bold', true,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'payment_lines', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'right', 'bold', true, 'label_ar', 'وسائل الدفع', 'label_en', 'Payments', 'label_mode', 'ar'),
          'method', jsonb_build_object('visible', false, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الدفع', 'label_en', 'Payment', 'label_mode', 'ar'),
          'status', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الحالة', 'label_en', 'Status', 'label_mode', 'ar'),
          'change', jsonb_build_object('visible', true, 'font_pt', 15, 'align', 'center', 'bold', true, 'label_ar', 'الباقي', 'label_en', 'Change', 'label_mode', 'ar')
        )
      ),
      'ops', jsonb_build_object(
        'visible', true, 'font_pt', 14, 'align', 'right', 'bold', false,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'shift_reference', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'رقم الوردية', 'label_en', 'Shift', 'label_mode', 'ar'),
          'branch_name', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'الفرع', 'label_en', 'Branch', 'label_mode', 'ar'),
          'device_name', jsonb_build_object('visible', false, 'font_pt', 14, 'align', 'right', 'bold', false, 'label_ar', 'الجهاز', 'label_en', 'Device', 'label_mode', 'ar')
        )
      ),
      'qr', jsonb_build_object(
        'visible', false, 'font_pt', 14, 'align', 'center', 'bold', false,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'code', jsonb_build_object('visible', true, 'font_pt', 14, 'align', 'center', 'bold', false, 'label_ar', '', 'label_mode', 'ar')
        )
      ),
      'thank_you', jsonb_build_object(
        'visible', true, 'font_pt', 16, 'align', 'center', 'bold', true,
        'space_before', 2, 'space_after', 2,
        'fields', jsonb_build_object(
          'message', jsonb_build_object('visible', true, 'font_pt', 16, 'align', 'center', 'bold', true, 'label_ar', '', 'label_mode', 'ar')
        )
      )
    )
  );
END;
$$;

-- Apply migration to all saved layouts
UPDATE public.print_document_layouts d
SET layout = public.m6_migrate_layout_fields_v3(d.layout, d.document_type),
    updated_at = now()
WHERE d.document_type IN ('receipt', 'kitchen');

NOTIFY pgrst, 'reload schema';
