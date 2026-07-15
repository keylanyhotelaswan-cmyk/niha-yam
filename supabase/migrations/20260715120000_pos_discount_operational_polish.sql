-- POS discount operational polish (safe surgery)
-- 1) apply_order_discount — set/clear discount on editable orders
-- 2) cancel reason on update_fulfillment_status
-- 3) get_order_detail exposes discount type/value/reason
-- 4) print snapshot enriched with discount_type/value/label (appended below)

CREATE OR REPLACE FUNCTION public.apply_order_discount(
  p_order_id uuid,
  p_discount jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_order public.orders%ROWTYPE;
  v_disc_type public.discount_type;
  v_disc_value numeric;
  v_disc_reason text;
  v_disc_amt numeric := 0;
  v_new_total numeric;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF public.m5c_order_has_approved_collection(p_order_id) THEN
    RAISE EXCEPTION 'FREE_EDIT_BLOCKED_AFTER_APPROVE';
  END IF;

  IF p_discount IS NULL OR p_discount = 'null'::jsonb THEN
    v_disc_amt := 0;
    v_disc_type := NULL;
    v_disc_value := NULL;
    v_disc_reason := NULL;
  ELSE
    IF NOT public.pos_staff_can_discount() THEN RAISE EXCEPTION 'DISCOUNT_NOT_ALLOWED'; END IF;
    v_disc_type := (p_discount->>'type')::public.discount_type;
    v_disc_value := (p_discount->>'value')::numeric;
    v_disc_reason := nullif(trim(coalesce(p_discount->>'reason', '')), '');
    IF v_disc_value IS NULL OR v_disc_value <= 0 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF v_disc_type = 'percent' AND v_disc_value > 100 THEN RAISE EXCEPTION 'INVALID_DISCOUNT'; END IF;
    IF length(coalesce(v_disc_reason, '')) = 0 THEN RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED'; END IF;

    IF v_disc_type = 'percent' THEN
      v_disc_amt := round(v_order.subtotal * v_disc_value / 100, 2);
    ELSE
      v_disc_amt := v_disc_value;
    END IF;
    IF v_disc_amt > v_order.subtotal THEN v_disc_amt := v_order.subtotal; END IF;
  END IF;

  v_new_total := greatest(v_order.subtotal - v_disc_amt, 0);

  UPDATE public.orders SET
    discount_amount = v_disc_amt,
    discount_type = v_disc_type,
    discount_value = v_disc_value,
    discount_reason = v_disc_reason,
    total = v_new_total,
    last_edited_by = v_staff,
    last_edited_at = now()
  WHERE id = p_order_id;

  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  PERFORM public.record_order_event(
    p_order_id, 'order.total_changed', 'order', p_order_id,
    jsonb_build_object(
      'from_total', v_order.total,
      'to_total', v_new_total,
      'discount_amount', v_disc_amt,
      'discount_type', v_disc_type::text,
      'discount_value', v_disc_value
    )
  );

  PERFORM public.log_audit_event(
    v_rest, 'order.edited', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('discount_amount', v_disc_amt, 'discount_type', v_disc_type::text)
  );

  RETURN public.m5c_order_money_snapshot(p_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_order_discount(uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.update_fulfillment_status(uuid, public.order_fulfillment_status);

CREATE OR REPLACE FUNCTION public.update_fulfillment_status(
  p_order_id uuid,
  p_status public.order_fulfillment_status,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_old public.order_fulfillment_status;
  v_payload jsonb;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT fulfillment_status INTO v_old FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF p_status = 'cancelled' THEN
    IF v_old IN ('delivered', 'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
    END IF;
  END IF;

  UPDATE public.orders SET fulfillment_status = p_status WHERE id = p_order_id;

  v_payload := jsonb_build_object('from', v_old::text, 'to', p_status::text);
  IF p_status = 'cancelled' THEN
    v_payload := v_payload || jsonb_build_object('reason', trim(p_reason), 'by', v_staff);
  END IF;

  IF p_status = 'delivered' THEN
    PERFORM public.record_order_event(p_order_id, 'order.delivered', 'order', p_order_id, v_payload);
  ELSIF p_status = 'cancelled' THEN
    PERFORM public.record_order_event(p_order_id, 'order.cancelled', 'order', p_order_id, v_payload);
  ELSE
    PERFORM public.record_order_event(p_order_id, 'fulfillment.updated', 'order', p_order_id, v_payload);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_fulfillment_status(
  uuid, public.order_fulfillment_status, text
) TO authenticated;

-- Enrich get_order_detail (based on operational_completion_v11 + discount fields)
CREATE OR REPLACE FUNCTION public.get_order_detail(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_order public.orders%ROWTYPE;
  v_money jsonb;
  v_created_name text;
  v_edited_name text;
  v_collected_by uuid;
  v_collected_at timestamptz;
  v_collected_name text;
  v_driver_name text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_money := public.m5c_order_money_snapshot(p_order_id);
  SELECT display_name INTO v_created_name FROM public.staff WHERE id = v_order.created_by;
  SELECT display_name INTO v_edited_name FROM public.staff WHERE id = v_order.last_edited_by;
  SELECT op.created_by, op.created_at INTO v_collected_by, v_collected_at
  FROM public.order_payments op
  WHERE op.order_id = p_order_id AND op.collection_status IN ('pending', 'approved')
  ORDER BY op.created_at DESC LIMIT 1;
  SELECT display_name INTO v_collected_name FROM public.staff WHERE id = v_collected_by;
  SELECT display_name INTO v_driver_name FROM public.delivery_drivers WHERE id = v_order.delivery_driver_id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'order_type', v_order.order_type,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'print_status', v_order.print_status,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount_amount', v_order.discount_amount,
      'discount_type', v_order.discount_type,
      'discount_value', v_order.discount_value,
      'discount_reason', v_order.discount_reason,
      'total', v_order.total,
      'order_note', v_order.order_note,
      'customer_id', v_order.customer_id,
      'delivery_name', v_order.delivery_name,
      'delivery_phone', v_order.delivery_phone,
      'delivery_address', v_order.delivery_address,
      'delivery_zone', v_order.delivery_zone,
      'dine_in_table_ref', v_order.dine_in_table_ref,
      'delivery_driver_id', v_order.delivery_driver_id,
      'delivery_driver_name', v_driver_name,
      'created_by', v_order.created_by,
      'cashier_name', v_created_name,
      'created_by_name', v_created_name,
      'created_at', v_order.created_at,
      'last_edited_by', v_order.last_edited_by,
      'last_edited_by_name', v_edited_name,
      'last_edited_at', v_order.last_edited_at,
      'collected_by', v_collected_by,
      'collected_by_name', v_collected_name,
      'collected_at', v_collected_at,
      'shift_id', v_order.shift_id,
      'requires_review', v_order.requires_review,
      'review_reason', v_order.review_reason,
      'can_free_edit', NOT public.m5c_order_has_approved_collection(p_order_id)
    ),
    'money', v_money,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'name', oi.name,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'line_total', oi.line_total,
        'menu_item_id', oi.menu_item_id,
        'line_note', oi.line_note,
        'is_open_price', oi.is_open_price
      ) ORDER BY oi.sort_order)
      FROM public.order_items oi WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'collections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id,
        'reference', op.reference,
        'amount', op.amount,
        'change_given', op.change_given,
        'net_amount', coalesce(op.net_amount, op.amount - coalesce(op.change_given, 0)),
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'payment_method_code', pm.code,
        'payment_method_name', pm.name,
        'created_at', op.created_at,
        'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op
      JOIN public.payment_methods pm ON pm.id = op.payment_method_id
      WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
    'payment_breakdown', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'payment_method_id', x.payment_method_id,
        'code', x.code,
        'name', x.name,
        'amount', x.amount
      ))
      FROM (
        SELECT pm.id AS payment_method_id, pm.code, pm.name,
          round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amount
        FROM public.order_payments op
        JOIN public.payment_methods pm ON pm.id = op.payment_method_id
        WHERE op.order_id = p_order_id
          AND op.collection_status IN ('pending', 'approved')
        GROUP BY pm.id, pm.code, pm.name
      ) x
    ), '[]'::jsonb),
    'timeline', public.get_order_timeline(p_order_id)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Print payload discount enrichment


NOTIFY pgrst, 'reload schema';

-- Print payload discount enrichment
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
      'discount_type', v_o.discount_type,
      'discount_value', v_o.discount_value,
      'discount_label_ar', CASE
        WHEN v_o.discount_type = 'percent' AND coalesce(v_o.discount_value, 0) > 0
          THEN 'خصم ' || trim(to_char(v_o.discount_value, 'FM999999990.##')) || '%'
        WHEN v_o.discount_type = 'amount' AND coalesce(v_o.discount_value, 0) > 0
          THEN 'خصم ' || trim(to_char(v_o.discount_value, 'FM999999990.00')) || ' ج.م'
        WHEN coalesce(v_o.discount_amount, 0) > 0
          THEN 'خصم ' || trim(to_char(v_o.discount_amount, 'FM999999990.00')) || ' ج.م'
        ELSE NULL
      END,
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


NOTIFY pgrst, 'reload schema';
