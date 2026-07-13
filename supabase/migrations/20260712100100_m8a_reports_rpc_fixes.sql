-- Fix M8A report RPCs: order_payments has no restaurant_id; expenses use description not notes.

CREATE OR REPLACE FUNCTION public.report_official_sales(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m8_require_reports_viewer();
  v_from timestamptz;
  v_to timestamptz;
  v_total numeric := 0;
  v_count int := 0;
  v_by_method jsonb;
  v_by_type jsonb;
  v_by_day jsonb;
  v_voided_count int := 0;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT coalesce(sum(op.net_amount), 0), count(*)
  INTO v_total, v_count
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE o.restaurant_id = v_rest
    AND op.collection_status = 'approved'
    AND coalesce(op.approved_at, op.created_at) >= v_from
    AND coalesce(op.approved_at, op.created_at) < v_to
    AND o.status IS DISTINCT FROM 'voided';

  SELECT count(*) INTO v_voided_count
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.status = 'voided'
    AND o.created_at >= v_from
    AND o.created_at < v_to;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.amount DESC), '[]'::jsonb)
  INTO v_by_method
  FROM (
    SELECT
      pm.id AS payment_method_id,
      pm.name,
      pm.code,
      count(*)::int AS count,
      coalesce(sum(op.net_amount), 0) AS amount
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE o.restaurant_id = v_rest
      AND op.collection_status = 'approved'
      AND coalesce(op.approved_at, op.created_at) >= v_from
      AND coalesce(op.approved_at, op.created_at) < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY pm.id, pm.name, pm.code
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.order_type), '[]'::jsonb)
  INTO v_by_type
  FROM (
    SELECT
      o.order_type::text AS order_type,
      count(DISTINCT o.id)::int AS order_count,
      coalesce(sum(op.net_amount), 0) AS amount
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE o.restaurant_id = v_rest
      AND op.collection_status = 'approved'
      AND coalesce(op.approved_at, op.created_at) >= v_from
      AND coalesce(op.approved_at, op.created_at) < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY o.order_type
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.day), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      (coalesce(op.approved_at, op.created_at) AT TIME ZONE 'Africa/Cairo')::date AS day,
      count(*)::int AS count,
      coalesce(sum(op.net_amount), 0) AS amount
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE o.restaurant_id = v_rest
      AND op.collection_status = 'approved'
      AND coalesce(op.approved_at, op.created_at) >= v_from
      AND coalesce(op.approved_at, op.created_at) < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY 1
  ) x;

  RETURN jsonb_build_object(
    'mode', 'official',
    'from', p_from,
    'to', p_to,
    'official_sales_total', v_total,
    'approved_collection_count', v_count,
    'by_payment_method', v_by_method,
    'by_order_type', v_by_type,
    'by_day', v_by_day,
    'voided_orders_count', v_voided_count,
    'voided_note', 'voided_orders_excluded_from_official_sales'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_expenses(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m8_require_reports_viewer();
  v_from timestamptz;
  v_to timestamptz;
  v_executed_total numeric := 0;
  v_pending_total numeric := 0;
  v_executed_count int := 0;
  v_pending_count int := 0;
  v_by_category jsonb;
  v_rows jsonb;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT
    coalesce(sum(amount) FILTER (WHERE status = 'executed'), 0),
    count(*) FILTER (WHERE status = 'executed'),
    coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0),
    count(*) FILTER (WHERE status = 'pending')
  INTO v_executed_total, v_executed_count, v_pending_total, v_pending_count
  FROM public.expenses e
  WHERE e.restaurant_id = v_rest
    AND e.created_at >= v_from
    AND e.created_at < v_to;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.amount DESC), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT
      e.category::text AS category,
      count(*)::int AS count,
      coalesce(sum(e.amount), 0) AS amount
    FROM public.expenses e
    WHERE e.restaurant_id = v_rest
      AND e.status = 'executed'
      AND e.created_at >= v_from
      AND e.created_at < v_to
    GROUP BY e.category
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      e.id,
      e.amount,
      e.category::text AS category,
      e.status::text AS status,
      e.description,
      e.created_at,
      e.reference,
      t.name AS treasury_name
    FROM public.expenses e
    LEFT JOIN public.treasuries t ON t.id = e.treasury_id
    WHERE e.restaurant_id = v_rest
      AND e.created_at >= v_from
      AND e.created_at < v_to
      AND e.status IN ('pending', 'executed', 'rejected', 'reversed')
    ORDER BY e.created_at DESC
    LIMIT 500
  ) x;

  RETURN jsonb_build_object(
    'mode', 'official',
    'from', p_from,
    'to', p_to,
    'executed_total', v_executed_total,
    'executed_count', v_executed_count,
    'pending_total', v_pending_total,
    'pending_count', v_pending_count,
    'by_category', v_by_category,
    'rows', v_rows
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
