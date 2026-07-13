-- Fix: m6_build_order_print_payload must not INSERT while marked STABLE

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

  -- Read-only: no INSERT in STABLE function (defaults if row missing)
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

NOTIFY pgrst, 'reload schema';
