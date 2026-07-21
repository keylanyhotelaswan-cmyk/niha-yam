-- Cancelled orders: block new collections; expose cancel audit in lists.
-- Order numbering: visible reference resets per open shift (1, 2, 3…).

-- ---------------------------------------------------------------------------
-- 1) Shift-scoped order references
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS uq_orders_reference;

ALTER TABLE public.orders
  ADD CONSTRAINT uq_orders_shift_reference
  UNIQUE (restaurant_id, shift_id, reference);

CREATE OR REPLACE FUNCTION public.next_shift_order_ref(
  p_restaurant_id uuid,
  p_shift_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
  v_ref text;
  v_guard int := 0;
BEGIN
  PERFORM 1
  FROM public.shifts
  WHERE id = p_shift_id AND restaurant_id = p_restaurant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  SELECT coalesce(
    max(
      CASE
        WHEN o.reference ~ '^[0-9]+$' THEN o.reference::bigint
        ELSE 0
      END
    ),
    0
  ) + 1
  INTO v_next
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.shift_id = p_shift_id;

  LOOP
    v_ref := v_next::text;
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.restaurant_id = p_restaurant_id
        AND o.shift_id = p_shift_id
        AND o.reference = v_ref
    );
    v_next := v_next + 1;
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      RAISE EXCEPTION 'REFERENCE_EXHAUSTED';
    END IF;
  END LOOP;

  RETURN v_ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_financial_ref(
  p_restaurant_id uuid,
  p_ref_type text,
  p_prefix text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v bigint;
  v_ref text;
  v_max bigint;
  v_guard int := 0;
  v_shift uuid;
BEGIN
  -- Orders: visible number restarts at 1 for each open shift.
  IF p_ref_type = 'order' THEN
    SELECT s.id
    INTO v_shift
    FROM public.shifts s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.status = 'open'
    ORDER BY s.opened_at DESC
    LIMIT 1;
    IF v_shift IS NOT NULL THEN
      RETURN public.next_shift_order_ref(p_restaurant_id, v_shift);
    END IF;
  END IF;

  v_max := public.financial_ref_table_max(p_restaurant_id, p_ref_type, p_prefix);

  INSERT INTO public.financial_ref_counters (restaurant_id, ref_type, current_value)
  VALUES (p_restaurant_id, p_ref_type, greatest(1, v_max + 1))
  ON CONFLICT (restaurant_id, ref_type)
  DO UPDATE SET current_value = GREATEST(
    public.financial_ref_counters.current_value + 1,
    v_max + 1
  )
  RETURNING current_value INTO v;

  v_ref := p_prefix || '-' || lpad(v::text, 6, '0');

  WHILE public.financial_ref_exists(p_restaurant_id, p_ref_type, v_ref) LOOP
    v_guard := v_guard + 1;
    IF v_guard > 1000 THEN RAISE EXCEPTION 'REFERENCE_EXHAUSTED'; END IF;
    UPDATE public.financial_ref_counters
    SET current_value = current_value + 1
    WHERE restaurant_id = p_restaurant_id AND ref_type = p_ref_type
    RETURNING current_value INTO v;
    v_ref := p_prefix || '-' || lpad(v::text, 6, '0');
  END LOOP;

  RETURN v_ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_ref_exists(
  p_restaurant_id uuid,
  p_ref_type text,
  p_reference text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift uuid;
BEGIN
  IF p_ref_type = 'order' THEN
    -- Legacy ORD-* remain restaurant-unique; numeric refs are shift-scoped.
    IF p_reference ~ '^[0-9]+$' THEN
      SELECT s.id INTO v_shift
      FROM public.shifts s
      WHERE s.restaurant_id = p_restaurant_id AND s.status = 'open'
      ORDER BY s.opened_at DESC LIMIT 1;
      IF v_shift IS NOT NULL THEN
        RETURN EXISTS (
          SELECT 1 FROM public.orders
          WHERE restaurant_id = p_restaurant_id
            AND shift_id = v_shift
            AND reference = p_reference
        );
      END IF;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.orders
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'payment' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND op.reference = p_reference
    );
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.kitchen_tickets
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'print_job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.print_jobs
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'handover' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.shift_handovers
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'shift' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.shifts
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'expense' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expenses
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type IN ('deposit', 'withdrawal') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.treasury_adjustments
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSE
    RETURN EXISTS (
      SELECT 1 FROM public.treasury_transfers
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_shift_order_ref(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Block collections on cancelled orders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_order_accepts_collection(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_status public.order_fulfillment_status;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT fulfillment_status
  INTO v_status
  FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_collection(
  p_order_id uuid,
  p_tenders jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_total numeric;
  v_paid_pending numeric;
  v_paid_approved numeric;
  v_remaining numeric;
  v_tender jsonb;
  v_pm public.payment_methods%ROWTYPE;
  v_tender_amt numeric;
  v_pay_ref text;
  v_pay_id uuid;
  v_net numeric;
  v_tender_change numeric;
  v_remaining_due numeric;
  v_cash_tender numeric;
  v_non_cash numeric;
  v_cash_required numeric;
  v_tender_sum numeric := 0;
  v_ids uuid[] := '{}';
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  PERFORM public.assert_order_accepts_collection(p_order_id);

  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Re-check after lock (cancelled between checks)
  PERFORM public.assert_order_accepts_collection(p_order_id);

  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_pending
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'pending';
  SELECT coalesce(sum(coalesce(net_amount, amount - change_given)), 0) INTO v_paid_approved
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'approved';
  v_remaining := v_total - v_paid_approved - v_paid_pending;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  v_remaining_due := v_remaining;
  v_cash_tender := 0;
  v_non_cash := 0;
  v_tender_sum := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    v_tender_amt := (v_tender->>'amount')::numeric;
    IF coalesce(v_tender_amt, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
    IF v_pm.code = 'cash' THEN v_cash_tender := v_cash_tender + v_tender_amt;
    ELSE
      IF v_tender_amt > v_remaining_due + 0.001 THEN RAISE EXCEPTION 'DIGITAL_OVERPAY'; END IF;
      v_non_cash := v_non_cash + v_tender_amt;
      v_remaining_due := v_remaining_due - v_tender_amt;
    END IF;
  END LOOP;

  IF v_tender_sum <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
  v_cash_required := least(v_remaining, v_non_cash + v_cash_tender) - v_non_cash;
  IF v_cash_required < 0 THEN v_cash_required := 0; END IF;
  IF v_cash_tender < v_cash_required THEN RAISE EXCEPTION 'UNDERPAID'; END IF;

  v_remaining_due := v_remaining;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods WHERE id = (v_tender->>'payment_method_id')::uuid;
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_change := 0;
    IF v_pm.code = 'cash' THEN
      v_net := least(v_tender_amt, v_remaining_due);
      v_tender_change := v_tender_amt - v_net;
      v_remaining_due := v_remaining_due - v_net;
    ELSE
      v_net := v_tender_amt;
      v_remaining_due := v_remaining_due - v_net;
    END IF;

    v_pay_ref := public.next_financial_ref(v_rest, 'payment', 'PAY');
    INSERT INTO public.order_payments (
      order_id, reference, payment_method_id, treasury_id, amount, change_given,
      shift_id, collection_status, net_amount, created_by
    ) VALUES (
      p_order_id, v_pay_ref, v_pm.id, v_pm.treasury_id, v_tender_amt, v_tender_change,
      v_shift, 'pending', v_net, v_staff
    ) RETURNING id INTO v_pay_id;

    v_ids := array_append(v_ids, v_pay_id);
    PERFORM public.record_order_event(p_order_id, 'collection.recorded', 'order_payment', v_pay_id,
      jsonb_build_object('reference', v_pay_ref, 'amount', v_tender_amt, 'net_amount', v_net));
  END LOOP;

  PERFORM public.m5b_recalc_order_payment_status(p_order_id);
  PERFORM public.m6_enqueue_receipt_on_collection(p_order_id);

  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_remaining(p_order_id uuid, p_tenders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_snap jsonb;
  v_result jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  PERFORM public.assert_order_accepts_collection(p_order_id);
  v_snap := public.m5c_order_money_snapshot(p_order_id);
  IF (v_snap->>'remaining_amount')::numeric <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  v_result := public.record_collection(p_order_id, p_tenders);
  PERFORM public.m5b_recalc_order_payment_status(p_order_id);

  RETURN jsonb_build_object(
    'payment_ids', v_result->'payment_ids',
    'money', public.m5c_order_money_snapshot(p_order_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_order_accepts_collection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_collection(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_remaining(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Cancelled order registry metadata in list + detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_orders_for_pos(
  p_date date DEFAULT CURRENT_DATE,
  p_payment_status text DEFAULT NULL,
  p_fulfillment_status text DEFAULT NULL,
  p_order_type text DEFAULT NULL,
  p_cashier_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_pending_collections_only boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_shift_id uuid DEFAULT NULL,
  p_hub_only boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_search text;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_search := nullif(trim(coalesce(p_search, '')), '');

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', o.id,
        'reference', o.reference,
        'order_type', o.order_type,
        'payment_status', o.payment_status,
        'fulfillment_status', o.fulfillment_status,
        'print_status', o.print_status,
        'total', o.total,
        'order_total', o.total,
        'collected_amount', public.m5c_order_collected_amount(o.id),
        'remaining_amount', greatest(o.total - public.m5c_order_collected_amount(o.id), 0),
        'requires_review', o.requires_review,
        'created_at', o.created_at,
        'created_by', o.created_by,
        'created_by_name', cr.display_name,
        'shift_id', o.shift_id,
        'customer_name', coalesce(o.delivery_name, c.display_name),
        'pending_collections', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'pending'
        ),
        'has_approved_collection', public.m5c_order_has_approved_collection(o.id),
        'cancel_reason', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT nullif(trim(coalesce(oe.payload->>'reason', '')), '')
            FROM public.order_events oe
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'cancelled_at', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT oe.created_at
            FROM public.order_events oe
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'cancelled_by_name', CASE
          WHEN o.fulfillment_status = 'cancelled' THEN (
            SELECT st.display_name
            FROM public.order_events oe
            LEFT JOIN public.staff st ON st.id = oe.actor_id
            WHERE oe.order_id = o.id AND oe.event_type = 'order.cancelled'
            ORDER BY oe.created_at DESC LIMIT 1
          )
          ELSE NULL
        END,
        'reversed_collections_count', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'reversed'
        ),
        'payment_breakdown', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'payment_method_id', pm.id,
            'code', pm.code,
            'name', pm.name,
            'amount', sub.amt
          ) ORDER BY pm.sort_order)
          FROM (
            SELECT op.payment_method_id,
              round(sum(op.amount - coalesce(op.change_given, 0))::numeric, 2) AS amt
            FROM public.order_payments op
            WHERE op.order_id = o.id
              AND op.collection_status IN ('pending', 'approved')
            GROUP BY op.payment_method_id
          ) sub
          JOIN public.payment_methods pm ON pm.id = sub.payment_method_id
        ), '[]'::jsonb)
      ) AS row, o.created_at
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
      LEFT JOIN public.staff cr ON cr.id = o.created_by
      WHERE o.restaurant_id = v_rest
        AND (
          CASE
            WHEN p_shift_id IS NOT NULL THEN o.shift_id = p_shift_id
            ELSE o.created_at >= p_date::timestamptz
              AND o.created_at < (p_date + 1)::timestamptz
          END
        )
        AND (
          CASE
            WHEN p_fulfillment_status = 'cancelled' THEN
              o.fulfillment_status = 'cancelled'
            WHEN p_fulfillment_status IS NOT NULL THEN
              o.fulfillment_status::text = p_fulfillment_status
            ELSE
              o.fulfillment_status <> 'cancelled'
          END
        )
        AND (
          NOT p_hub_only
          OR o.payment_status IN ('unpaid', 'partial')
          OR o.requires_review = true
          OR o.fulfillment_status IN ('new', 'preparing', 'ready')
        )
        AND (p_payment_status IS NULL OR o.payment_status::text = p_payment_status)
        AND (p_order_type IS NULL OR o.order_type::text = p_order_type)
        AND (p_cashier_id IS NULL OR o.created_by = p_cashier_id)
        AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
        AND (
          p_pending_collections_only = false OR EXISTS (
            SELECT 1 FROM public.order_payments op
            WHERE op.order_id = o.id AND op.collection_status = 'pending'
          )
        )
        AND (
          v_search IS NULL
          OR o.reference ILIKE '%' || v_search || '%'
          OR o.delivery_phone ILIKE '%' || v_search || '%'
          OR o.delivery_name ILIKE '%' || v_search || '%'
          OR c.display_name ILIKE '%' || v_search || '%'
          OR EXISTS (
            SELECT 1 FROM public.customer_phones cp
            WHERE cp.customer_id = o.customer_id
              AND cp.phone_normalized LIKE '%' || public.normalize_phone(v_search) || '%'
          )
        )
      ORDER BY o.created_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END;
$$;

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
  v_cancel_reason text;
  v_cancelled_at timestamptz;
  v_cancelled_by_name text;
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

  IF v_order.fulfillment_status = 'cancelled' THEN
    SELECT
      nullif(trim(coalesce(oe.payload->>'reason', '')), ''),
      oe.created_at,
      st.display_name
    INTO v_cancel_reason, v_cancelled_at, v_cancelled_by_name
    FROM public.order_events oe
    LEFT JOIN public.staff st ON st.id = oe.actor_id
    WHERE oe.order_id = p_order_id AND oe.event_type = 'order.cancelled'
    ORDER BY oe.created_at DESC
    LIMIT 1;
  END IF;

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
      'can_free_edit', NOT public.m5c_order_has_approved_collection(p_order_id),
      'cancel_reason', v_cancel_reason,
      'cancelled_at', v_cancelled_at,
      'cancelled_by_name', v_cancelled_by_name
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
        'rejection_reason', op.rejection_reason,
        'reversal_reason', op.reversal_reason
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

GRANT EXECUTE ON FUNCTION public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_detail(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
