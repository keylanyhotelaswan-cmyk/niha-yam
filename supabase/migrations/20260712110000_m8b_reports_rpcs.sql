-- M8B Reports: S5 orders summary · S6 delivery by driver · S7 item mix · S8 print reliability

CREATE OR REPLACE FUNCTION public.report_orders_summary(p_from date, p_to date)
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
  v_active_count int := 0;
  v_active_total numeric := 0;
  v_voided_count int := 0;
  v_voided_total numeric := 0;
  v_by_type jsonb;
  v_by_status jsonb;
  v_by_payment jsonb;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT count(*), coalesce(sum(total), 0)
  INTO v_active_count, v_active_total
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.status IS DISTINCT FROM 'voided'
    AND o.status IS DISTINCT FROM 'refunded';

  SELECT count(*), coalesce(sum(total), 0)
  INTO v_voided_count, v_voided_total
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.status = 'voided';

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.order_type), '[]'::jsonb)
  INTO v_by_type
  FROM (
    SELECT
      o.order_type::text AS order_type,
      count(*)::int AS count,
      coalesce(sum(o.total), 0) AS total
    FROM public.orders o
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.status IS DISTINCT FROM 'voided'
      AND o.status IS DISTINCT FROM 'refunded'
    GROUP BY o.order_type
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.status), '[]'::jsonb)
  INTO v_by_status
  FROM (
    SELECT
      o.status::text AS status,
      count(*)::int AS count,
      coalesce(sum(o.total), 0) AS total
    FROM public.orders o
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
    GROUP BY o.status
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.payment_status), '[]'::jsonb)
  INTO v_by_payment
  FROM (
    SELECT
      coalesce(o.payment_status::text, 'unknown') AS payment_status,
      count(*)::int AS count,
      coalesce(sum(o.total), 0) AS total
    FROM public.orders o
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.status IS DISTINCT FROM 'voided'
      AND o.status IS DISTINCT FROM 'refunded'
    GROUP BY o.payment_status
  ) x;

  RETURN jsonb_build_object(
    'mode', 'ops',
    'from', p_from,
    'to', p_to,
    'active_orders_count', v_active_count,
    'active_orders_total', v_active_total,
    'voided_orders_count', v_voided_count,
    'voided_orders_total', v_voided_total,
    'by_order_type', v_by_type,
    'by_status', v_by_status,
    'by_payment_status', v_by_payment,
    'voided_section', 'separate_never_in_official_sales'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_delivery_by_driver(p_from date, p_to date)
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
  v_rows jsonb;
  v_unassigned int := 0;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT count(*) INTO v_unassigned
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND o.order_type = 'delivery'
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.status IS DISTINCT FROM 'voided'
    AND o.delivery_driver_id IS NULL;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.order_count DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      d.id AS driver_id,
      d.display_name AS driver_name,
      count(*)::int AS order_count,
      coalesce(sum(o.total), 0) AS order_total_sum
    FROM public.orders o
    JOIN public.delivery_drivers d ON d.id = o.delivery_driver_id
    WHERE o.restaurant_id = v_rest
      AND o.order_type = 'delivery'
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY d.id, d.display_name
  ) x;

  RETURN jsonb_build_object(
    'mode', 'ops',
    'from', p_from,
    'to', p_to,
    'by_driver', v_rows,
    'unassigned_delivery_count', v_unassigned
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_item_mix(p_from date, p_to date, p_limit int DEFAULT 50)
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
  v_items jsonb;
  v_categories jsonb;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  -- line_total is sold amount including modifiers (Q-R7)
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.qty_sold DESC, x.sales_total DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      oi.name AS item_name,
      coalesce(c.name, '—') AS category_name,
      sum(oi.quantity)::int AS qty_sold,
      coalesce(sum(oi.line_total), 0) AS sales_total,
      count(DISTINCT o.id)::int AS order_count
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    LEFT JOIN public.menu_categories c ON c.id = mi.category_id
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY oi.name, c.name
    ORDER BY sum(oi.quantity) DESC, sum(oi.line_total) DESC
    LIMIT LEAST(coalesce(p_limit, 50), 200)
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sales_total DESC), '[]'::jsonb)
  INTO v_categories
  FROM (
    SELECT
      coalesce(c.name, '—') AS category_name,
      sum(oi.quantity)::int AS qty_sold,
      coalesce(sum(oi.line_total), 0) AS sales_total
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
    LEFT JOIN public.menu_categories c ON c.id = mi.category_id
    WHERE o.restaurant_id = v_rest
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY c.name
    ORDER BY sum(oi.line_total) DESC
    LIMIT 50
  ) x;

  RETURN jsonb_build_object(
    'mode', 'ops',
    'from', p_from,
    'to', p_to,
    'by_item', v_items,
    'by_category', v_categories,
    'note', 'line_totals_include_modifiers'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_print_reliability(p_from date, p_to date)
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
  v_total int := 0;
  v_by_status jsonb;
  v_by_kind jsonb;
  v_failed int := 0;
  v_expired int := 0;
  v_completed int := 0;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT count(*) INTO v_total
  FROM public.print_jobs j
  WHERE j.restaurant_id = v_rest
    AND j.created_at >= v_from AND j.created_at < v_to;

  SELECT
    count(*) FILTER (WHERE status::text = 'failed'),
    count(*) FILTER (WHERE status::text = 'expired'),
    count(*) FILTER (WHERE status::text = 'completed')
  INTO v_failed, v_expired, v_completed
  FROM public.print_jobs j
  WHERE j.restaurant_id = v_rest
    AND j.created_at >= v_from AND j.created_at < v_to;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.status), '[]'::jsonb)
  INTO v_by_status
  FROM (
    SELECT
      j.status::text AS status,
      count(*)::int AS count
    FROM public.print_jobs j
    WHERE j.restaurant_id = v_rest
      AND j.created_at >= v_from AND j.created_at < v_to
    GROUP BY j.status
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.kind), '[]'::jsonb)
  INTO v_by_kind
  FROM (
    SELECT
      j.kind::text AS kind,
      count(*)::int AS count,
      count(*) FILTER (WHERE j.status::text = 'completed')::int AS completed,
      count(*) FILTER (WHERE j.status::text IN ('failed', 'expired'))::int AS failed_or_expired
    FROM public.print_jobs j
    WHERE j.restaurant_id = v_rest
      AND j.created_at >= v_from AND j.created_at < v_to
    GROUP BY j.kind
  ) x;

  RETURN jsonb_build_object(
    'mode', 'ops',
    'from', p_from,
    'to', p_to,
    'jobs_total', v_total,
    'completed', v_completed,
    'failed', v_failed,
    'expired', v_expired,
    'success_rate',
      CASE WHEN v_total = 0 THEN NULL
      ELSE round((v_completed::numeric / v_total::numeric) * 100, 1) END,
    'by_status', v_by_status,
    'by_kind', v_by_kind
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_orders_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_delivery_by_driver(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_item_mix(date, date, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_print_reliability(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
