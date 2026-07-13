-- Operational Hardening v1.1 — reliability follow-ups
-- OH-1: day totals manager-only
-- OH-5: serialize open_shift against concurrent open; keep drawer lock first

-- =============================================================================
-- OH-1: Cashiers must not resolve day-wide collection totals via RPC
-- =============================================================================
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
    AND o.created_at >= v_from AND o.created_at < v_to;

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

-- =============================================================================
-- OH-5: open_shift — lock drawer first, then re-check open shift (race-safe)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.open_shift(
  p_opening_float numeric,
  p_receive_handover_id uuid DEFAULT NULL,
  p_received_actual_cash numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_ref text;
  v_pending public.shift_handovers%ROWTYPE;
  v_float numeric := coalesce(p_opening_float, 0);
  v_has_pending_next boolean := false;
  v_recv_actual numeric;
  v_recv_var numeric := 0;
  v_updated int;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_float < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  -- Serialize concurrent open / close / receive against the drawer
  PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open') THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;

  SELECT * INTO v_pending FROM public.shift_handovers
  WHERE restaurant_id = v_rest AND status = 'pending' AND kind = 'to_next_shift'
  ORDER BY created_at
  FOR UPDATE
  LIMIT 1;
  v_has_pending_next := FOUND;

  IF v_has_pending_next THEN
    IF p_receive_handover_id IS NULL OR p_receive_handover_id <> v_pending.id THEN
      RAISE EXCEPTION 'PENDING_NEXT_HANDOVER';
    END IF;
    IF p_received_actual_cash IS NULL THEN
      RAISE EXCEPTION 'RECEIVE_COUNT_REQUIRED';
    END IF;
    IF p_received_actual_cash < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_recv_actual := round(p_received_actual_cash::numeric, 2);
    v_recv_var := round((v_recv_actual - v_pending.amount)::numeric, 2);
  ELSIF p_receive_handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'shift', 'SH');
  INSERT INTO public.shifts (restaurant_id, reference, opened_by, status)
  VALUES (v_rest, v_ref, v_actor, 'open') RETURNING id INTO v_shift;

  IF v_float > 0 THEN
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_float, 'opening_float', 'shift', v_shift, v_ref, v_actor);
  END IF;

  IF v_has_pending_next THEN
    UPDATE public.shift_handovers
    SET status = 'executed',
        received_by = v_actor,
        received_at = now(),
        target_shift_id = v_shift,
        received_actual_cash = v_recv_actual,
        receive_variance = v_recv_var
    WHERE id = v_pending.id AND status = 'pending';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

    IF abs(v_recv_var) > 0.001 THEN
      INSERT INTO public.treasury_movements
        (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
         reference, created_by)
      VALUES (
        v_rest, v_drawer, v_shift, v_recv_var, 'variance', 'shift_handover', v_pending.id,
        public.next_financial_ref(v_rest, 'variance', 'VR'), v_actor
      );
    END IF;

    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_pending.id, NULL,
      jsonb_build_object(
        'kind', 'to_next_shift',
        'amount', v_pending.amount,
        'received_actual_cash', v_recv_actual,
        'receive_variance', v_recv_var,
        'reference', v_pending.reference,
        'target_shift_id', v_shift,
        'receiver_opening_float', v_float,
        'starting_trust', round((v_recv_actual + v_float)::numeric, 2)
      ));
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', v_float, 'reference', v_ref,
      'received_handover_id', p_receive_handover_id));
  RETURN v_shift;
END;
$$;
