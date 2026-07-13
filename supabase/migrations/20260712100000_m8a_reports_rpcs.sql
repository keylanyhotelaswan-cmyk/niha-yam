-- M8A Reports: read-only compute-from-source RPCs (S0 + S1–S4)
-- ADR-0032 · docs/m8-reports-plan.md

CREATE OR REPLACE FUNCTION public.m8_require_reports_viewer()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same gate as managers for M8A (owner/manager). Named for F2 later.
  RETURN public.m4_require_manager();
END;
$$;

CREATE OR REPLACE FUNCTION public.m8_assert_date_range(p_from date, p_to date)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;
  IF (p_to - p_from) > 30 THEN
    -- inclusive window max 31 calendar days
    RAISE EXCEPTION 'RANGE_TOO_LARGE';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.m8_range_bounds(p_from date, p_to date)
RETURNS TABLE (o_from timestamptz, o_to timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  PERFORM public.m8_assert_date_range(p_from, p_to);
  RETURN QUERY SELECT
    (p_from::timestamp AT TIME ZONE 'Africa/Cairo'),
    ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo');
END;
$$;

-- ---------------------------------------------------------------------------
-- list_shifts_for_reports
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_shifts_for_reports(p_from date, p_to date)
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
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.opened_at DESC)
    FROM (
      SELECT
        s.id,
        s.reference,
        s.status::text AS status,
        s.opened_at,
        s.closed_at,
        st.display_name AS opened_by_name
      FROM public.shifts s
      LEFT JOIN public.staff st ON st.id = s.opened_by
      WHERE s.restaurant_id = v_rest
        AND s.opened_at >= v_from
        AND s.opened_at < v_to
      ORDER BY s.opened_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- report_official_sales (S2) — approved collections only; voided orders excluded
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- report_expenses (S4)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- report_treasury_ledger (S3 date-filtered)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_treasury_ledger(
  p_treasury_id uuid,
  p_from date,
  p_to date,
  p_limit int DEFAULT 500
)
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
  v_bal numeric;
  v_name text;
  v_rows jsonb;
BEGIN
  SELECT b.o_from, b.o_to INTO v_from, v_to FROM public.m8_range_bounds(p_from, p_to) b;

  SELECT name INTO v_name
  FROM public.treasuries
  WHERE id = p_treasury_id AND restaurant_id = v_rest;
  IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_bal := public.treasury_balance(p_treasury_id);

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      mv.id,
      mv.amount,
      mv.source::text AS source,
      mv.reference,
      mv.created_at,
      s.display_name AS created_by
    FROM public.treasury_movements mv
    LEFT JOIN public.staff s ON s.id = mv.created_by
    WHERE mv.treasury_id = p_treasury_id
      AND mv.restaurant_id = v_rest
      AND mv.created_at >= v_from
      AND mv.created_at < v_to
    ORDER BY mv.created_at DESC
    LIMIT LEAST(coalesce(p_limit, 500), 1000)
  ) x;

  RETURN jsonb_build_object(
    'mode', 'official',
    'treasury_id', p_treasury_id,
    'treasury_name', v_name,
    'official_balance', v_bal,
    'from', p_from,
    'to', p_to,
    'rows', v_rows
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- report_today_summary (S0) — composes same helpers as S1–S4
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_today_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m8_require_reports_viewer();
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_sales jsonb;
  v_expenses jsonb;
  v_shift_id uuid;
  v_shift jsonb;
  v_drawer uuid;
  v_op_bal numeric;
  v_orders_total int := 0;
  v_by_type jsonb;
  v_voided int := 0;
  v_alerts jsonb := '[]'::jsonb;
BEGIN
  v_sales := public.report_official_sales(v_today, v_today);
  v_expenses := public.report_expenses(v_today, v_today);

  SELECT id INTO v_shift_id
  FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    v_shift := public.get_shift_report(v_shift_id);
    SELECT id INTO v_drawer
    FROM public.treasuries
    WHERE restaurant_id = v_rest AND is_shift_drawer = true
    LIMIT 1;
    IF v_drawer IS NOT NULL THEN
      v_op_bal := public.m5b_operational_treasury_balance(v_drawer, v_shift_id);
    END IF;
  END IF;

  SELECT count(*) INTO v_orders_total
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date = v_today
    AND o.status IS DISTINCT FROM 'voided';

  SELECT count(*) INTO v_voided
  FROM public.orders o
  WHERE o.restaurant_id = v_rest
    AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date = v_today
    AND o.status = 'voided';

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.order_type), '[]'::jsonb)
  INTO v_by_type
  FROM (
    SELECT
      o.order_type::text AS order_type,
      count(*)::int AS count,
      coalesce(sum(o.total), 0) AS order_total_sum
    FROM public.orders o
    WHERE o.restaurant_id = v_rest
      AND (o.created_at AT TIME ZONE 'Africa/Cairo')::date = v_today
      AND o.status IS DISTINCT FROM 'voided'
    GROUP BY o.order_type
  ) x;

  IF coalesce((v_sales->>'voided_orders_count')::int, 0) > 0 OR v_voided > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'voided_orders',
      'message', 'توجد طلبات ملغاة اليوم — مستبعدة من المبيعات الرسمية',
      'count', greatest(v_voided, coalesce((v_sales->>'voided_orders_count')::int, 0))
    ));
  END IF;

  IF v_shift IS NOT NULL AND coalesce((v_shift->>'pending_collections_count')::int, 0) > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'pending_collections',
      'message', 'تحصيلات معلّقة بانتظار الاعتماد',
      'count', (v_shift->>'pending_collections_count')::int,
      'amount', (v_shift->>'pending_collections_amount')::numeric
    ));
  END IF;

  IF coalesce((v_expenses->>'pending_count')::int, 0) > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'pending_expenses',
      'message', 'مصروفات معلّقة بانتظار الاعتماد',
      'count', (v_expenses->>'pending_count')::int,
      'amount', (v_expenses->>'pending_total')::numeric
    ));
  END IF;

  RETURN jsonb_build_object(
    'day', v_today,
    'official_sales_total', (v_sales->>'official_sales_total')::numeric,
    'by_payment_method', v_sales->'by_payment_method',
    'orders_count', v_orders_total,
    'orders_by_type', v_by_type,
    'voided_orders_count', v_voided,
    'executed_expenses_total', (v_expenses->>'executed_total')::numeric,
    'pending_collections_count', coalesce((v_shift->>'pending_collections_count')::int, 0),
    'pending_collections_amount', coalesce((v_shift->>'pending_collections_amount')::numeric, 0),
    'pending_expenses_count', coalesce((v_expenses->>'pending_count')::int, 0),
    'pending_expenses_amount', coalesce((v_expenses->>'pending_total')::numeric, 0),
    'operational_drawer_balance', v_op_bal,
    'operational_mode', 'operational',
    'open_shift', v_shift,
    'alerts', v_alerts,
    'sales_report', v_sales,
    'expenses_report', v_expenses
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.m8_require_reports_viewer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.m8_assert_date_range(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m8_range_bounds(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shifts_for_reports(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_official_sales(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_expenses(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_treasury_ledger(uuid, date, date, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_today_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
