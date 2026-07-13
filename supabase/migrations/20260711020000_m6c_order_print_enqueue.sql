-- M6C: Document-type order print enqueue (kitchen@create, receipt@collection)

-- ---------------------------------------------------------------------------
-- Payload builder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_build_order_print_payload(
  p_order_id uuid,
  p_kind public.print_job_kind
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_cashier text;
  v_kt_ref text;
  v_lines jsonb;
  v_payments jsonb;
  v_snapshot jsonb;
  v_forbid_prices boolean := (p_kind = 'kitchen');
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_o.created_by;
  SELECT reference INTO v_kt_ref FROM public.kitchen_tickets
  WHERE order_id = p_order_id ORDER BY created_at DESC LIMIT 1;

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
    ) ORDER BY op.created_at), '[]'::jsonb)
    INTO v_payments
    FROM public.order_payments op
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE op.order_id = p_order_id
      AND op.collection_status IN ('pending', 'approved');
  END IF;

  v_snapshot := jsonb_build_object(
    'order_id', v_o.id,
    'order_reference', v_o.reference,
    'order_type', v_o.order_type::text,
    'datetime', to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI'),
    'cashier', v_cashier,
    'order_note', v_o.order_note,
    'customer_name', coalesce(v_o.delivery_name, ''),
    'table_ref', v_o.dine_in_table_ref,
    'kitchen_ticket', v_kt_ref,
    'lines', coalesce(v_lines, '[]'::jsonb),
    'forbid_prices', v_forbid_prices
  );

  IF NOT v_forbid_prices THEN
    v_snapshot := v_snapshot || jsonb_build_object(
      'subtotal', v_o.subtotal,
      'discount_amount', v_o.discount_amount,
      'total', v_o.total,
      'payments', coalesce(v_payments, '[]'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'order_reference', v_o.reference,
    'kind', p_kind::text,
    'data_snapshot', v_snapshot
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Document-type enqueue (single entry point)
-- ---------------------------------------------------------------------------
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
    -- Soft-skip: sale must not fail when printer unassigned
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

-- Kitchen @ create; receipt only when p_print_receipt (Pay Now)
CREATE OR REPLACE FUNCTION public.m6_enqueue_order_prints_on_create(
  p_order_id uuid,
  p_print_receipt boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_needs_kitchen boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND needs_kitchen = true
  ) INTO v_needs_kitchen;

  IF v_needs_kitchen THEN
    PERFORM public.m6_enqueue_document_print(p_order_id, 'kitchen', false, NULL);
  END IF;

  IF p_print_receipt THEN
    PERFORM public.m6_enqueue_document_print(p_order_id, 'receipt', false, NULL);
  END IF;

  IF NOT v_needs_kitchen AND NOT p_print_receipt THEN
    UPDATE public.orders SET print_status = 'not_needed' WHERE id = p_order_id;
  ELSE
    PERFORM public.m6_refresh_order_print_status(p_order_id);
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.m6_enqueue_receipt_on_collection(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.m6_enqueue_document_print(p_order_id, 'receipt', false, NULL);
END; $$;

-- ---------------------------------------------------------------------------
-- reprint_order → document-type helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reprint_order(
  p_order_id uuid,
  p_kind public.print_job_kind DEFAULT 'receipt',
  p_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_pj uuid;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_kind NOT IN ('receipt', 'kitchen') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_pj := public.m6_enqueue_document_print(p_order_id, p_kind, true, trim(p_reason));
  IF v_pj IS NULL THEN
    RAISE EXCEPTION 'NO_PRINTER';
  END IF;
  RETURN v_pj;
END; $$;

GRANT EXECUTE ON FUNCTION public.m6_build_order_print_payload(uuid, public.print_job_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_enqueue_document_print(uuid, public.print_job_kind, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_enqueue_order_prints_on_create(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m6_enqueue_receipt_on_collection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprint_order(uuid, public.print_job_kind, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
