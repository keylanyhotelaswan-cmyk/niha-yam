-- Full shift performance report in handover print snapshot (routing unchanged).
-- Enrich m6_build_handover_print_snapshot for Bridge HandoverSnapshotRender.

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
  v_report jsonb;
  v_title text;
  v_orders_count int := 0;
  v_sales_total numeric := 0;
  v_discount numeric := 0;
  v_cancelled int := 0;
  v_exp_total numeric := 0;
  v_avg_ticket numeric := 0;
  v_top_rev jsonb;
  v_top_qty jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_phase NOT IN ('handover', 'receive') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  SELECT * INTO v_h FROM public.shift_handovers WHERE id = p_handover_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_h.shift_id;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_h.created_by;
  SELECT display_name INTO v_receiver FROM public.staff WHERE id = coalesce(v_h.received_by, public.auth_staff_id());

  v_coll := public.get_shift_collection_totals(v_h.shift_id);
  v_report := public.get_shift_report(v_h.shift_id);

  SELECT count(*)::int INTO v_orders_count
  FROM public.orders o
  WHERE o.shift_id = v_h.shift_id AND o.restaurant_id = v_rest
    AND coalesce(o.fulfillment_status::text, '') <> 'cancelled';

  SELECT coalesce(sum(o.total), 0) INTO v_sales_total
  FROM public.orders o
  WHERE o.shift_id = v_h.shift_id AND o.restaurant_id = v_rest
    AND coalesce(o.fulfillment_status::text, '') <> 'cancelled';

  SELECT coalesce(sum(coalesce(o.discount_amount, 0)), 0) INTO v_discount
  FROM public.orders o
  WHERE o.shift_id = v_h.shift_id AND o.restaurant_id = v_rest
    AND coalesce(o.fulfillment_status::text, '') <> 'cancelled';

  SELECT count(*)::int INTO v_cancelled
  FROM public.orders o
  WHERE o.shift_id = v_h.shift_id AND o.restaurant_id = v_rest
    AND o.fulfillment_status::text = 'cancelled';

  SELECT coalesce(sum(e.amount), 0) INTO v_exp_total
  FROM public.expenses e
  WHERE e.shift_id = v_h.shift_id AND e.restaurant_id = v_rest
    AND e.status = 'executed';

  IF v_orders_count > 0 THEN
    v_avg_ticket := round(v_sales_total / v_orders_count, 2);
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  INTO v_top_rev
  FROM (
    SELECT oi.name AS name_ar,
           sum(oi.quantity)::numeric AS qty,
           round(sum(oi.line_total)::numeric, 2) AS sales
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.restaurant_id = v_rest
      AND o.shift_id = v_h.shift_id
      AND coalesce(o.fulfillment_status::text, '') <> 'cancelled'
    GROUP BY oi.name
    ORDER BY sum(oi.line_total) DESC, sum(oi.quantity) DESC
    LIMIT 5
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  INTO v_top_qty
  FROM (
    SELECT oi.name AS name_ar,
           sum(oi.quantity)::numeric AS qty,
           round(sum(oi.line_total)::numeric, 2) AS sales
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.restaurant_id = v_rest
      AND o.shift_id = v_h.shift_id
      AND coalesce(o.fulfillment_status::text, '') <> 'cancelled'
    GROUP BY oi.name
    ORDER BY sum(oi.quantity) DESC, sum(oi.line_total) DESC
    LIMIT 5
  ) x;

  v_title := CASE
    WHEN p_phase = 'receive' THEN 'تقرير استلام الوردية'
    ELSE 'تقرير غلق الوردية'
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
    'variance', coalesce((v_report->>'variance')::numeric, 0),
    'actual_cash_count', v_shift.actual_cash_count,
    'printed_at', now(),
    'payment_methods', coalesce(v_coll->'by_payment_method', '[]'::jsonb),
    'total_collected', coalesce((v_coll->>'total_collected')::numeric, 0),
    'trust_note_ar', 'العهدة النقدية فقط — باقي الوسائل للمراجعة',
    'ops', jsonb_build_object(
      'sales_total', v_sales_total,
      'orders_count', v_orders_count,
      'avg_ticket', v_avg_ticket,
      'expenses_total', v_exp_total,
      'discounts_total', v_discount,
      'refunds_total', coalesce((v_report->>'refunds')::numeric, 0),
      'cancelled_orders', v_cancelled,
      'approved_revenue', coalesce((v_report->>'approved_revenue')::numeric, v_sales_total)
    ),
    'cash', jsonb_build_object(
      'opening_float', coalesce((v_report->>'opening_float')::numeric, 0),
      'opening_balance', coalesce((v_report->>'opening_balance')::numeric, 0),
      'expected_cash', coalesce((v_report->>'expected_cash')::numeric, 0),
      'actual_cash', coalesce(
        (v_report->>'actual_cash')::numeric,
        v_shift.actual_cash_count,
        0
      ),
      'variance', coalesce((v_report->>'variance')::numeric, 0),
      'trust_amount', v_h.amount,
      'cash_sales', coalesce((v_report->>'cash_sales')::numeric, 0)
    ),
    'top_items_by_revenue', coalesce(v_top_rev, '[]'::jsonb),
    'top_items_by_qty', coalesce(v_top_qty, '[]'::jsonb)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
