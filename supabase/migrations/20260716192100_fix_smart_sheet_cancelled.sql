-- Fix smart sheet: cancelled orders use fulfillment_status = cancelled
CREATE OR REPLACE FUNCTION public.get_smart_shift_sheet(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift public.shifts%ROWTYPE;
  v_report jsonb;
  v_collections jsonb;
  v_handover jsonb;
  v_expenses jsonb;
  v_purchases jsonb;
  v_payments jsonb;
  v_transfers jsonb;
  v_top_items jsonb;
  v_cancelled int;
  v_discount numeric;
  v_duration_min numeric;
  v_opener text;
  v_closer text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_shift FROM public.shifts
  WHERE id = p_shift_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_report := public.get_shift_report(p_shift_id);
  v_collections := public.get_shift_collection_totals(p_shift_id);

  SELECT jsonb_build_object(
    'id', h.id,
    'reference', h.reference,
    'kind', h.kind,
    'amount', h.amount,
    'status', h.status,
    'review_status', h.review_status,
    'review_notes', h.review_notes,
    'reviewed_at', h.reviewed_at,
    'created_at', h.created_at,
    'received_at', h.received_at
  )
  INTO v_handover
  FROM public.shift_handovers h
  WHERE h.shift_id = p_shift_id
  ORDER BY h.created_at DESC
  LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'reference', e.reference,
    'amount', e.amount,
    'category', e.category,
    'description', e.description,
    'vendor', e.vendor,
    'status', e.status
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_expenses
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.restaurant_id = v_rest;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'reference', p.reference,
    'total_amount', p.total_amount,
    'payment_method', p.payment_method,
    'source_kind', p.source_kind,
    'status', p.status,
    'created_at', p.created_at
  ) ORDER BY p.created_at), '[]'::jsonb)
  INTO v_purchases
  FROM public.purchases p
  WHERE p.restaurant_id = v_rest
    AND p.created_at >= v_shift.opened_at
    AND (v_shift.closed_at IS NULL OR p.created_at <= v_shift.closed_at);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'reference', sp.reference,
    'amount', sp.amount,
    'supplier_name_ar', s.name_ar,
    'status', sp.status,
    'created_at', sp.created_at
  ) ORDER BY sp.created_at), '[]'::jsonb)
  INTO v_payments
  FROM public.supplier_payments sp
  JOIN public.suppliers s ON s.id = sp.supplier_id
  WHERE sp.restaurant_id = v_rest
    AND sp.created_at >= v_shift.opened_at
    AND (v_shift.closed_at IS NULL OR sp.created_at <= v_shift.closed_at);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'reference', t.reference,
    'amount', t.amount,
    'is_cash_drop', t.is_cash_drop,
    'reason', t.reason,
    'status', t.status
  ) ORDER BY t.created_at), '[]'::jsonb)
  INTO v_transfers
  FROM public.treasury_transfers t
  WHERE t.restaurant_id = v_rest
    AND t.shift_id = p_shift_id
    AND t.status = 'executed';

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  INTO v_top_items
  FROM (
    SELECT oi.name AS name_ar,
           sum(oi.quantity)::numeric AS qty,
           sum(oi.line_total)::numeric AS sales
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.restaurant_id = v_rest
      AND o.shift_id = p_shift_id
      AND coalesce(o.fulfillment_status::text, '') <> 'cancelled'
    GROUP BY oi.name
    ORDER BY sum(oi.line_total) DESC
    LIMIT 10
  ) x;

  SELECT count(*)::int INTO v_cancelled
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest
    AND o.fulfillment_status::text = 'cancelled';

  SELECT coalesce(sum(coalesce(o.discount_amount, 0)), 0) INTO v_discount
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest
    AND coalesce(o.fulfillment_status::text, '') <> 'cancelled';

  v_duration_min := CASE
    WHEN v_shift.closed_at IS NOT NULL THEN
      round(extract(epoch FROM (v_shift.closed_at - v_shift.opened_at)) / 60.0, 1)
    ELSE
      round(extract(epoch FROM (now() - v_shift.opened_at)) / 60.0, 1)
  END;

  SELECT display_name INTO v_opener FROM public.staff WHERE id = v_shift.opened_by;
  SELECT display_name INTO v_closer FROM public.staff WHERE id = v_shift.closed_by;

  RETURN jsonb_build_object(
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'reference', v_shift.reference,
      'status', v_shift.status,
      'opened_at', v_shift.opened_at,
      'closed_at', v_shift.closed_at,
      'duration_minutes', v_duration_min,
      'opened_by_name', v_opener,
      'closed_by_name', v_closer,
      'actual_cash_count', v_shift.actual_cash_count,
      'difference_reason', v_shift.difference_reason,
      'notes', v_shift.notes
    ),
    'report', v_report,
    'collections', v_collections,
    'handover', v_handover,
    'expenses', v_expenses,
    'purchases', v_purchases,
    'supplier_payments', v_payments,
    'transfers', v_transfers,
    'top_items', v_top_items,
    'cancelled_orders', v_cancelled,
    'discounts_total', v_discount,
    'summary_ar', jsonb_build_object(
      'title', 'ملخص استلام الوردية',
      'review_only_note', 'اعتماد المدير للمراجعة فقط — لا يوقف التشغيل ولا يحرّك السيولة'
    )
  );
END;
$$;
