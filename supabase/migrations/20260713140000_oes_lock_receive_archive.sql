-- OES: lock PIN verify + Path B receive float + handover receive/archive detail

-- ---------------------------------------------------------------------------
-- Verify PIN for the CURRENT authenticated staff only (lock screen — no user switch)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_my_pin(p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid := public.auth_staff_id();
BEGIN
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN false;
  END IF;
  RETURN public.verify_staff_pin(v_staff, trim(p_pin));
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_my_pin(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- open_shift: allow opening float IN ADDITION to Path B receive (drawer already has trust)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_shift(
  p_opening_float numeric,
  p_receive_handover_id uuid DEFAULT NULL
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
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF EXISTS (SELECT 1 FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open') THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_OPEN';
  END IF;
  IF v_float < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  SELECT * INTO v_pending FROM public.shift_handovers
  WHERE restaurant_id = v_rest AND status = 'pending' AND kind = 'to_next_shift'
  ORDER BY created_at LIMIT 1;
  v_has_pending_next := FOUND;

  IF v_has_pending_next THEN
    IF p_receive_handover_id IS NULL OR p_receive_handover_id <> v_pending.id THEN
      RAISE EXCEPTION 'PENDING_NEXT_HANDOVER';
    END IF;
    -- Keep p_opening_float: trust stays in drawer; float is additional cash the receiver brings.
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
    SET status = 'executed', received_by = v_actor, received_at = now(), target_shift_id = v_shift
    WHERE id = v_pending.id;
    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_pending.id, NULL,
      jsonb_build_object(
        'kind', 'to_next_shift',
        'amount', v_pending.amount,
        'reference', v_pending.reference,
        'target_shift_id', v_shift,
        'receiver_opening_float', v_float,
        'starting_trust', round((v_pending.amount + v_float)::numeric, 2)
      ));
  END IF;

  PERFORM public.log_audit_event(v_rest, 'shift.opened', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('opening_float', v_float, 'reference', v_ref,
      'received_handover_id', p_receive_handover_id));
  RETURN v_shift;
END;
$$;

-- ---------------------------------------------------------------------------
-- Pending handovers: variance + actual/expected for receive screen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_handovers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at)
    FROM (
      SELECT
        h.id,
        h.reference,
        h.shift_id,
        s.reference AS shift_reference,
        h.kind::text AS kind,
        h.amount,
        h.status::text AS status,
        h.created_at,
        st.display_name AS cashier_name,
        h.created_by,
        s.actual_cash_count,
        round(coalesce((
          SELECT sum(m.amount)
          FROM public.treasury_movements m
          WHERE m.shift_id = h.shift_id AND m.source = 'variance'
        ), 0)::numeric, 2) AS source_variance,
        round(coalesce((
          SELECT (public.get_shift_report(h.shift_id)->>'expected_cash')::numeric
        ), 0)::numeric, 2) AS source_expected_cash
      FROM public.shift_handovers h
      JOIN public.shifts s ON s.id = h.shift_id
      LEFT JOIN public.staff st ON st.id = h.created_by
      WHERE h.restaurant_id = v_rest AND h.status = 'pending'
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Archive: full receive chain fields on each handover
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_shifts_archive(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.opened_at DESC)
    FROM (
      SELECT s.id, s.reference, s.status, s.opened_at, s.closed_at, s.actual_cash_count,
        opener.display_name AS opened_by_name, closer.display_name AS closed_by_name,
        round(coalesce((
          SELECT sum(m.amount) FROM public.treasury_movements m
          WHERE m.shift_id = s.id AND m.source = 'variance'
        ), 0)::numeric, 2) AS shift_variance,
        (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', h.id,
            'reference', h.reference,
            'kind', h.kind::text,
            'amount', h.amount,
            'status', h.status::text,
            'created_at', h.created_at,
            'received_at', h.received_at,
            'rejected_at', h.rejected_at,
            'rejection_reason', h.rejection_reason,
            'cashier_name', cs.display_name,
            'received_by_name', rs.display_name,
            'target_shift_id', h.target_shift_id,
            'target_shift_reference', ts.reference,
            'source_variance', round(coalesce((
              SELECT sum(vm.amount) FROM public.treasury_movements vm
              WHERE vm.shift_id = h.shift_id AND vm.source = 'variance'
            ), 0)::numeric, 2),
            'receiver_opening_float', round(coalesce((
              SELECT sum(om.amount) FROM public.treasury_movements om
              WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
            ), 0)::numeric, 2),
            'receiver_starting_trust', round((
              h.amount + coalesce((
                SELECT sum(om.amount) FROM public.treasury_movements om
                WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
              ), 0)
            )::numeric, 2)
          ) ORDER BY h.created_at), '[]'::jsonb)
          FROM public.shift_handovers h
          LEFT JOIN public.staff cs ON cs.id = h.created_by
          LEFT JOIN public.staff rs ON rs.id = h.received_by
          LEFT JOIN public.shifts ts ON ts.id = h.target_shift_id
          WHERE h.shift_id = s.id
        ) AS handovers
      FROM public.shifts s
      LEFT JOIN public.staff opener ON opener.id = s.opened_by
      LEFT JOIN public.staff closer ON closer.id = s.closed_by
      WHERE s.restaurant_id = v_rest
      ORDER BY s.opened_at DESC
      LIMIT LEAST(coalesce(p_limit, 50), 200)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shift_archive(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_report jsonb;
  v_handovers jsonb;
  v_orders jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  v_report := public.get_shift_report(p_shift_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'reference', h.reference,
    'kind', h.kind::text,
    'amount', h.amount,
    'status', h.status::text,
    'created_at', h.created_at,
    'received_at', h.received_at,
    'rejected_at', h.rejected_at,
    'rejection_reason', h.rejection_reason,
    'cashier_name', cs.display_name,
    'received_by_name', rs.display_name,
    'rejected_by_name', js.display_name,
    'target_shift_id', h.target_shift_id,
    'transfer_id', h.transfer_id,
    'target_shift_reference', ts.reference,
    'source_variance', round(coalesce((
      SELECT sum(vm.amount) FROM public.treasury_movements vm
      WHERE vm.shift_id = h.shift_id AND vm.source = 'variance'
    ), 0)::numeric, 2),
    'receiver_opening_float', round(coalesce((
      SELECT sum(om.amount) FROM public.treasury_movements om
      WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
    ), 0)::numeric, 2),
    'receiver_starting_trust', round((
      h.amount + coalesce((
        SELECT sum(om.amount) FROM public.treasury_movements om
        WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
      ), 0)
    )::numeric, 2)
  ) ORDER BY h.created_at), '[]'::jsonb)
  INTO v_handovers
  FROM public.shift_handovers h
  LEFT JOIN public.staff cs ON cs.id = h.created_by
  LEFT JOIN public.staff rs ON rs.id = h.received_by
  LEFT JOIN public.staff js ON js.id = h.rejected_by
  LEFT JOIN public.shifts ts ON ts.id = h.target_shift_id
  WHERE h.shift_id = p_shift_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.reference, 'order_type', o.order_type::text,
    'payment_status', o.payment_status::text, 'fulfillment_status', o.fulfillment_status::text,
    'total', o.total, 'created_at', o.created_at
  ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_orders
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest;

  RETURN jsonb_build_object('report', v_report, 'handovers', v_handovers, 'orders', v_orders);
END;
$$;

NOTIFY pgrst, 'reload schema';
