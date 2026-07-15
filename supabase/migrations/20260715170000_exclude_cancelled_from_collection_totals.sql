-- Exclude cancelled orders from collection-status KPIs (محصل / غير محصل).
-- Cancelled tickets stay in DB/audit but must not inflate hub money cards.

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
  v_paid numeric := 0;
  v_unpaid numeric := 0;
  v_partial numeric := 0;
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
      AND o.fulfillment_status <> 'cancelled'
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

  SELECT
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'paid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'unpaid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'partial'), 0)
  INTO v_paid, v_unpaid, v_partial
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.shift_id = p_shift_id
    AND o.fulfillment_status <> 'cancelled';

  RETURN jsonb_build_object(
    'scope', 'shift',
    'shift_id', p_shift_id,
    'by_payment_method', v_by,
    'total_collected', v_total,
    'trust_cash_total', v_trust,
    'by_collection_status', jsonb_build_object(
      'paid', round(v_paid::numeric, 2),
      'unpaid', round(v_unpaid::numeric, 2),
      'partial', round(v_partial::numeric, 2)
    )
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
  v_paid numeric := 0;
  v_unpaid numeric := 0;
  v_partial numeric := 0;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

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
      AND o.fulfillment_status <> 'cancelled'
      AND op.collection_status IN ('pending', 'approved')
    GROUP BY pm.id, pm.code, pm.name, pm.sort_order
    HAVING round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) <> 0
  ) x;

  SELECT coalesce(sum((e->>'amount')::numeric), 0) INTO v_total
  FROM jsonb_array_elements(v_by) e;

  SELECT
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'paid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'unpaid'), 0),
    coalesce(sum(o.total) FILTER (WHERE o.payment_status = 'partial'), 0)
  INTO v_paid, v_unpaid, v_partial
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.fulfillment_status <> 'cancelled';

  RETURN jsonb_build_object(
    'scope', 'day',
    'date', v_day,
    'by_payment_method', v_by,
    'total_collected', v_total,
    'by_collection_status', jsonb_build_object(
      'paid', round(v_paid::numeric, 2),
      'unpaid', round(v_unpaid::numeric, 2),
      'partial', round(v_partial::numeric, 2)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_collection_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_day_collection_totals(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
