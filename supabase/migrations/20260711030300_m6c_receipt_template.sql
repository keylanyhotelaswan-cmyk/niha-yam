-- M6C: Receipt branding fields + richer snapshot for classic Arabic receipt layout

ALTER TABLE public.print_settings
  ADD COLUMN IF NOT EXISTS receipt_slogan text,
  ADD COLUMN IF NOT EXISTS restaurant_phone text,
  ADD COLUMN IF NOT EXISTS restaurant_address text;

UPDATE public.print_settings
SET thank_you_message = coalesce(nullif(trim(thank_you_message), ''), 'شكراً لزيارتكم')
WHERE thank_you_message IS NULL OR trim(thank_you_message) = '';

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
  v_font_total int := 24;
  v_paper_w int := 80;
  v_auto_cut boolean := true;
  v_pay_status_ar text;
  v_pay_method text;
  v_local_ts timestamp;
  v_dt text;
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
    coalesce(font_total_pt, 24),
    coalesce(paper_width_mm, 80),
    coalesce(auto_cut, true)
  INTO
    v_thank_you, v_slogan, v_rest_phone, v_rest_address,
    v_show_qr, v_font_title, v_font_body, v_font_total, v_paper_w, v_auto_cut
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

DROP FUNCTION IF EXISTS public.upsert_print_settings(int, int, boolean, boolean, int, boolean, boolean, text, int, int, int);

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
    'receipt_slogan', v_row.receipt_slogan,
    'restaurant_phone', v_row.restaurant_phone,
    'restaurant_address', v_row.restaurant_address,
    'font_title_pt', v_row.font_title_pt,
    'font_body_pt', v_row.font_body_pt,
    'font_total_pt', v_row.font_total_pt
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
  p_thank_you_message text DEFAULT NULL,
  p_font_title_pt int DEFAULT NULL,
  p_font_body_pt int DEFAULT NULL,
  p_font_total_pt int DEFAULT NULL,
  p_receipt_slogan text DEFAULT NULL,
  p_restaurant_phone text DEFAULT NULL,
  p_restaurant_address text DEFAULT NULL
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
    receipt_slogan = CASE
      WHEN p_receipt_slogan IS NULL THEN receipt_slogan
      ELSE nullif(trim(p_receipt_slogan), '')
    END,
    restaurant_phone = CASE
      WHEN p_restaurant_phone IS NULL THEN restaurant_phone
      ELSE nullif(trim(p_restaurant_phone), '')
    END,
    restaurant_address = CASE
      WHEN p_restaurant_address IS NULL THEN restaurant_address
      ELSE nullif(trim(p_restaurant_address), '')
    END,
    updated_at = now()
  WHERE restaurant_id = v_rest;
  RETURN public.get_print_settings();
END; $$;

GRANT EXECUTE ON FUNCTION public.get_print_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_print_settings(
  int, int, boolean, boolean, int, boolean, boolean, text, int, int, int, text, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';
