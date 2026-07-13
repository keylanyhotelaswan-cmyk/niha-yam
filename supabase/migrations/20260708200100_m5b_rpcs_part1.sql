-- M5B: Helpers, collection approval RPCs, orders hub, refactored finalize_sale.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_order_event(
  p_order_id uuid,
  p_event_type text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid;
  v_actor uuid := coalesce(p_actor_id, public.auth_staff_id());
  v_id uuid;
  v_audit_action text;
BEGIN
  SELECT restaurant_id INTO v_rest FROM public.orders WHERE id = p_order_id;
  IF v_rest IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  INSERT INTO public.order_events (
    restaurant_id, order_id, event_type, actor_id, entity_type, entity_id, payload
  ) VALUES (
    v_rest, p_order_id, p_event_type, v_actor, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  v_audit_action := CASE p_event_type
    WHEN 'order.created' THEN 'order.created'
    WHEN 'collection.recorded' THEN 'order.collection_recorded'
    WHEN 'collection.approved' THEN 'order.collection_approved'
    WHEN 'collection.rejected' THEN 'order.collection_rejected'
    WHEN 'collection.reversed' THEN 'order.collection_reversed'
    WHEN 'order.amended' THEN 'order.amended'
    WHEN 'kitchen.sent' THEN 'kitchen.ticket_created'
    WHEN 'print.enqueued' THEN 'print.job_enqueued'
    WHEN 'fulfillment.updated' THEN 'order.fulfillment_updated'
    WHEN 'order.delivered' THEN 'order.fulfillment_updated'
    WHEN 'order.cancelled' THEN 'order.cancelled'
    ELSE NULL
  END;
  IF v_audit_action IS NOT NULL THEN
    PERFORM public.log_audit_event(v_rest, v_audit_action, NULL, v_actor,
      coalesce(p_entity_type, 'order'), coalesce(p_entity_id, p_order_id), NULL, p_payload);
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.m5b_recalc_order_payment_status(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total numeric;
  v_approved numeric;
  v_status public.order_payment_status;
BEGIN
  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id;
  SELECT coalesce(sum(net_amount), 0) INTO v_approved
  FROM public.order_payments
  WHERE order_id = p_order_id AND collection_status = 'approved';

  IF v_approved >= v_total THEN v_status := 'paid';
  ELSIF v_approved > 0 THEN v_status := 'partial';
  ELSE v_status := 'unpaid';
  END IF;

  UPDATE public.orders SET payment_status = v_status WHERE id = p_order_id;
END; $$;

CREATE OR REPLACE FUNCTION public.m5b_operational_treasury_balance(p_treasury_id uuid, p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.treasury_balance(p_treasury_id) + coalesce((
    SELECT sum(
      CASE
        WHEN pm.code = 'cash' THEN op.amount - op.change_given
        ELSE op.amount
      END
    )
    FROM public.order_payments op
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE op.shift_id = p_shift_id
      AND op.collection_status = 'pending'
      AND op.treasury_id = p_treasury_id
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.m5b_shift_approved_revenue(p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(net_amount), 0)
  FROM public.order_payments
  WHERE shift_id = p_shift_id AND collection_status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.m5b_pending_collections_summary(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_total numeric;
  v_by_method jsonb;
BEGIN
  SELECT count(*)::int, coalesce(sum(op.amount), 0)
  INTO v_count, v_total
  FROM public.order_payments op
  WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending';

  SELECT coalesce(jsonb_agg(row ORDER BY method_name), '[]'::jsonb) INTO v_by_method
  FROM (
    SELECT pm.name AS method_name,
      jsonb_build_object(
        'payment_method_id', pm.id,
        'name', pm.name,
        'code', pm.code,
        'count', count(*)::int,
        'amount', coalesce(sum(op.amount), 0)
      ) AS row
    FROM public.order_payments op
    JOIN public.payment_methods pm ON pm.id = op.payment_method_id
    WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending'
    GROUP BY pm.id, pm.name, pm.code
  ) sub;

  RETURN jsonb_build_object(
    'count', v_count,
    'amount', v_total,
    'by_payment_method', v_by_method
  );
END; $$;

-- Internal: post ledger for one approved payment row
CREATE OR REPLACE FUNCTION public.m5b_post_collection_ledger(p_payment_id uuid, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_op public.order_payments%ROWTYPE;
  v_rest uuid;
BEGIN
  SELECT * INTO v_op FROM public.order_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_op.collection_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  SELECT restaurant_id INTO v_rest FROM public.orders WHERE id = v_op.order_id;

  UPDATE public.order_payments
  SET collection_status = 'approved',
      approved_by = p_actor,
      approved_at = now(),
      net_amount = coalesce(net_amount, v_op.amount - v_op.change_given)
  WHERE id = p_payment_id;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, shift_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, v_op.treasury_id, v_op.shift_id,
    coalesce(v_op.net_amount, v_op.amount - v_op.change_given),
    'pos_payment', 'order_payment', p_payment_id, v_op.reference, p_actor
  );

  PERFORM public.m5b_recalc_order_payment_status(v_op.order_id);
  PERFORM public.record_order_event(
    v_op.order_id, 'collection.approved', 'order_payment', p_payment_id,
    jsonb_build_object('reference', v_op.reference, 'amount', v_op.amount,
      'net_amount', coalesce(v_op.net_amount, v_op.amount - v_op.change_given)),
    p_actor
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Collection approval (manager only — ADR-0025 P-1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_collection(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE op.id = p_id AND o.restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM public.m5b_post_collection_ledger(p_id, public.auth_staff_id());
END; $$;

CREATE OR REPLACE FUNCTION public.approve_collections(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager(); v_id uuid; v_actor uuid := public.auth_staff_id();
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      WHERE op.id = v_id AND o.restaurant_id = v_rest
    ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    PERFORM public.m5b_post_collection_ledger(v_id, v_actor);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_pending_for_shift(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT array_agg(op.id ORDER BY op.created_at), count(*)::int
  INTO v_ids, v_count
  FROM public.order_payments op
  WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending';

  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM public.m5b_post_collection_ledger(v_id, v_actor);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('approved_count', coalesce(v_count, 0));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_collection(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_op public.order_payments%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT op.* INTO v_op
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.id = p_id AND o.restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_op.collection_status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  UPDATE public.order_payments
  SET collection_status = 'rejected',
      rejected_by = public.auth_staff_id(),
      rejected_at = now(),
      rejection_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.m5b_recalc_order_payment_status(v_op.order_id);
  PERFORM public.record_order_event(
    v_op.order_id, 'collection.rejected', 'order_payment', p_id,
    jsonb_build_object('reference', v_op.reference, 'reason', trim(p_reason))
  );
END; $$;

CREATE OR REPLACE FUNCTION public.reject_collections(p_ids uuid[], p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.reject_collection(v_id, p_reason);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_collection(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_op public.order_payments%ROWTYPE;
  v_net numeric;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT op.* INTO v_op
  FROM public.order_payments op
  JOIN public.orders o ON o.id = op.order_id
  WHERE op.id = p_id AND o.restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_op.collection_status <> 'approved' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  v_net := coalesce(v_op.net_amount, v_op.amount - v_op.change_given);

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, shift_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, v_op.treasury_id, v_op.shift_id, -v_net,
    'refund_reversal', 'order_payment_reversal', p_id, v_op.reference, public.auth_staff_id()
  );

  UPDATE public.order_payments
  SET collection_status = 'reversed',
      reversed_by = public.auth_staff_id(),
      reversed_at = now(),
      reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.m5b_recalc_order_payment_status(v_op.order_id);
  PERFORM public.record_order_event(
    v_op.order_id, 'collection.reversed', 'order_payment', p_id,
    jsonb_build_object('reference', v_op.reference, 'reason', trim(p_reason), 'net_amount', v_net)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Pending list (exceptions mode)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_collections_for_shift(
  p_shift_id uuid,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', op.id,
        'reference', op.reference,
        'order_id', o.id,
        'order_reference', o.reference,
        'amount', op.amount,
        'change_given', op.change_given,
        'net_amount', coalesce(op.net_amount, op.amount - op.change_given),
        'payment_method', pm.name,
        'payment_method_code', pm.code,
        'cashier_id', o.created_by,
        'customer_name', coalesce(o.delivery_name, c.display_name),
        'created_at', op.created_at
      ) AS row, op.created_at
      FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      JOIN public.payment_methods pm ON pm.id = op.payment_method_id
      LEFT JOIN public.customers c ON c.id = o.customer_id
      WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending'
      ORDER BY op.created_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END; $$;

-- ---------------------------------------------------------------------------
-- Customer RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_customer_by_phone(p_phone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_norm text := public.normalize_phone(p_phone);
  v_customer_id uuid;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF v_norm IS NULL THEN RETURN NULL; END IF;

  SELECT cp.customer_id INTO v_customer_id
  FROM public.customer_phones cp
  WHERE cp.restaurant_id = v_rest AND cp.phone_normalized = v_norm
  LIMIT 1;

  IF v_customer_id IS NULL THEN RETURN NULL; END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'notes', c.notes,
      'phones', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cp.id, 'phone_raw', cp.phone_raw, 'label', cp.label, 'is_primary', cp.is_primary
        ) ORDER BY cp.is_primary DESC)
        FROM public.customer_phones cp WHERE cp.customer_id = c.id
      ), '[]'::jsonb),
      'addresses', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ca.id, 'label', ca.label, 'address_line', ca.address_line,
          'delivery_zone', ca.delivery_zone, 'is_default', ca.is_default
        ) ORDER BY ca.is_default DESC)
        FROM public.customer_addresses ca WHERE ca.customer_id = c.id
      ), '[]'::jsonb)
    )
    FROM public.customers c WHERE c.id = v_customer_id
  );
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_customer(
  p_display_name text,
  p_phone text,
  p_notes text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_norm text := public.normalize_phone(p_phone);
  v_id uuid;
  v_existing uuid;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_display_name, ''))) = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_norm IS NULL THEN RAISE EXCEPTION 'INVALID_PHONE'; END IF;

  SELECT customer_id INTO v_existing
  FROM public.customer_phones
  WHERE restaurant_id = v_rest AND phone_normalized = v_norm;

  IF v_existing IS NOT NULL THEN
    UPDATE public.customers
    SET display_name = trim(p_display_name),
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now()
    WHERE id = v_existing;
    v_id := v_existing;
    PERFORM public.log_audit_event(v_rest, 'customer.updated', NULL, v_staff, 'customer', v_id, NULL, NULL);
  ELSE
    INSERT INTO public.customers (restaurant_id, display_name, notes)
    VALUES (v_rest, trim(p_display_name), nullif(trim(coalesce(p_notes, '')), ''))
    RETURNING id INTO v_id;

    INSERT INTO public.customer_phones (customer_id, restaurant_id, phone_raw, phone_normalized, is_primary)
    VALUES (v_id, v_rest, trim(p_phone), v_norm, true);

    PERFORM public.log_audit_event(v_rest, 'customer.created', NULL, v_staff, 'customer', v_id, NULL, NULL);
  END IF;

  IF p_address IS NOT NULL AND length(trim(p_address)) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_addresses
      WHERE customer_id = v_id AND address_line = trim(p_address)
    ) THEN
      INSERT INTO public.customer_addresses (customer_id, restaurant_id, address_line, delivery_zone, is_default)
      VALUES (v_id, v_rest, trim(p_address), nullif(trim(coalesce(p_delivery_zone, '')), ''), true);
    END IF;
  END IF;

  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------------
-- Orders hub
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
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id(); v_search text;
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
        'created_at', o.created_at,
        'created_by', o.created_by,
        'customer_name', coalesce(o.delivery_name, c.display_name),
        'pending_collections', (
          SELECT count(*)::int FROM public.order_payments op
          WHERE op.order_id = o.id AND op.collection_status = 'pending'
        )
      ) AS row, o.created_at
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id
      WHERE o.restaurant_id = v_rest
        AND o.created_at >= p_date::timestamptz
        AND o.created_at < (p_date + 1)::timestamptz
        AND (p_payment_status IS NULL OR o.payment_status::text = p_payment_status)
        AND (p_fulfillment_status IS NULL OR o.fulfillment_status::text = p_fulfillment_status)
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
            WHERE cp.customer_id = o.customer_id AND cp.phone_normalized LIKE '%' || public.normalize_phone(v_search) || '%'
          )
        )
      ORDER BY o.created_at DESC
      LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_order_timeline(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'actor_id', e.actor_id,
      'entity_type', e.entity_type,
      'entity_id', e.entity_id,
      'payload', e.payload,
      'created_at', e.created_at
    ) ORDER BY e.created_at ASC)
    FROM public.order_events e
    WHERE e.order_id = p_order_id
  ), '[]'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public.get_order_detail(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_order public.orders%ROWTYPE;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

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
      'total', v_order.total,
      'order_note', v_order.order_note,
      'customer_id', v_order.customer_id,
      'delivery_name', v_order.delivery_name,
      'delivery_phone', v_order.delivery_phone,
      'delivery_address', v_order.delivery_address,
      'delivery_zone', v_order.delivery_zone,
      'created_by', v_order.created_by,
      'created_at', v_order.created_at
    ),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total, 'line_note', oi.line_note
      ) ORDER BY oi.sort_order)
      FROM public.order_items oi WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'collections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id, 'reference', op.reference, 'amount', op.amount,
        'change_given', op.change_given, 'net_amount', op.net_amount,
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'created_at', op.created_at, 'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
    'timeline', public.get_order_timeline(p_order_id)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- Fulfillment + reprint
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fulfillment_status(
  p_order_id uuid,
  p_status public.order_fulfillment_status
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_old public.order_fulfillment_status;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT fulfillment_status INTO v_old FROM public.orders
  WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  UPDATE public.orders SET fulfillment_status = p_status WHERE id = p_order_id;

  IF p_status = 'delivered' THEN
    PERFORM public.record_order_event(p_order_id, 'order.delivered', 'order', p_order_id,
      jsonb_build_object('from', v_old::text, 'to', p_status::text));
  ELSIF p_status = 'cancelled' THEN
    PERFORM public.record_order_event(p_order_id, 'order.cancelled', 'order', p_order_id,
      jsonb_build_object('from', v_old::text, 'to', p_status::text));
  ELSE
    PERFORM public.record_order_event(p_order_id, 'fulfillment.updated', 'order', p_order_id,
      jsonb_build_object('from', v_old::text, 'to', p_status::text));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.reprint_order(p_order_id uuid, p_kind public.print_job_kind DEFAULT 'receipt')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_ref text;
  v_pj uuid;
  v_ord_ref text;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT reference INTO v_ord_ref FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');
  INSERT INTO public.print_jobs (restaurant_id, order_id, reference, kind, status, payload)
  VALUES (v_rest, p_order_id, v_ref, p_kind, 'pending',
    jsonb_build_object('order_reference', v_ord_ref, 'reprint', true))
  RETURNING id INTO v_pj;

  PERFORM public.record_order_event(p_order_id, 'print.enqueued', 'print_job', v_pj,
    jsonb_build_object('kind', p_kind::text, 'reference', v_ref, 'reprint', true));
  PERFORM public.log_audit_event(v_rest, 'order.reprinted', NULL, v_staff, 'order', p_order_id, NULL,
    jsonb_build_object('kind', p_kind::text));
  RETURN v_pj;
END; $$;

-- ---------------------------------------------------------------------------
-- record_collection (standalone — delivery partial pay etc.)
-- ---------------------------------------------------------------------------
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
  v_ids uuid[] := '{}';
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);

  SELECT total INTO v_total FROM public.orders WHERE id = p_order_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT coalesce(sum(amount), 0) INTO v_paid_pending
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'pending';
  SELECT coalesce(sum(net_amount), 0) INTO v_paid_approved
  FROM public.order_payments WHERE order_id = p_order_id AND collection_status = 'approved';
  v_remaining := v_total - v_paid_approved - v_paid_pending;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID'; END IF;

  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;

  v_remaining_due := v_remaining;
  v_cash_tender := 0;
  v_non_cash := 0;
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    SELECT * INTO v_pm FROM public.payment_methods
    WHERE id = (v_tender->>'payment_method_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND OR v_pm.treasury_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_METHOD_UNMAPPED'; END IF;
    v_tender_amt := (v_tender->>'amount')::numeric;
    IF coalesce(v_tender_amt, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
    IF v_pm.code = 'cash' THEN v_cash_tender := v_cash_tender + v_tender_amt;
    ELSE
      IF v_tender_amt > v_remaining_due + 0.001 THEN RAISE EXCEPTION 'DIGITAL_OVERPAY'; END IF;
      v_non_cash := v_non_cash + v_tender_amt;
      v_remaining_due := v_remaining_due - v_tender_amt;
    END IF;
  END LOOP;

  v_cash_required := v_remaining - v_non_cash;
  IF v_cash_required < 0 THEN RAISE EXCEPTION 'INVALID_TENDER'; END IF;
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

  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));
END; $$;

-- ---------------------------------------------------------------------------
-- create_delivery_order (no payment — unpaid)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_delivery_order(
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_delivery_address text DEFAULT NULL,
  p_delivery_zone text DEFAULT NULL,
  p_delivery_notes text DEFAULT NULL,
  p_order_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_staff uuid := public.auth_staff_id();
  v_shift uuid;
  v_ord_ref text;
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_total numeric;
  v_line jsonb;
  v_item public.menu_items%ROWTYPE;
  v_unit numeric;
  v_line_total numeric;
  v_order_item_id uuid;
  v_sort int := 0;
  v_has_kitchen boolean := false;
  v_kt_id uuid;
  v_kt_ref text;
  v_cust_id uuid := p_customer_id;
  v_cust_name text;
  v_cust_phone text;
BEGIN
  IF v_rest IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;

  IF v_cust_id IS NULL AND p_customer_phone IS NOT NULL THEN
    v_cust_id := public.upsert_customer(
      coalesce(p_customer_name, 'عميل'),
      p_customer_phone,
      NULL,
      p_delivery_address,
      p_delivery_zone
    );
  END IF;

  IF v_cust_id IS NOT NULL THEN
    SELECT display_name INTO v_cust_name FROM public.customers WHERE id = v_cust_id;
    SELECT phone_raw INTO v_cust_phone FROM public.customer_phones
    WHERE customer_id = v_cust_id AND is_primary = true LIMIT 1;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items
    WHERE id = (v_line->>'menu_item_id')::uuid AND restaurant_id = v_rest AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_AVAILABLE'; END IF;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := v_subtotal;

  v_ord_ref := public.next_financial_ref(v_rest, 'order', 'ORD');
  INSERT INTO public.orders (
    restaurant_id, reference, shift_id, status, order_type,
    payment_status, fulfillment_status, print_status,
    subtotal, discount_amount, total, order_note,
    customer_id, delivery_name, delivery_phone, delivery_address, delivery_zone, delivery_notes,
    created_by, closed_at
  ) VALUES (
    v_rest, v_ord_ref, v_shift, 'closed', 'delivery',
    'unpaid', 'new', 'pending',
    v_subtotal, 0, v_total, nullif(trim(coalesce(p_order_note, '')), ''),
    v_cust_id,
    coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), v_cust_name),
    coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), v_cust_phone),
    nullif(trim(coalesce(p_delivery_address, '')), ''),
    nullif(trim(coalesce(p_delivery_zone, '')), ''),
    nullif(trim(coalesce(p_delivery_notes, '')), ''),
    v_staff, now()
  ) RETURNING id INTO v_order_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM public.menu_items WHERE id = (v_line->>'menu_item_id')::uuid;
    v_unit := CASE WHEN v_item.is_open_price THEN (v_line->>'open_price')::numeric ELSE v_item.base_price END;
    v_line_total := v_unit * greatest((v_line->>'quantity')::int, 1);
    IF v_item.needs_kitchen THEN v_has_kitchen := true; END IF;
    INSERT INTO public.order_items (
      order_id, menu_item_id, name, sku, unit_price, quantity, line_total,
      is_open_price, needs_kitchen, needs_print, line_note, sort_order
    ) VALUES (
      v_order_id, v_item.id, v_item.name, v_item.sku, v_unit,
      greatest((v_line->>'quantity')::int, 1), v_line_total,
      v_item.is_open_price, v_item.needs_kitchen, v_item.needs_print,
      nullif(trim(coalesce(v_line->>'note', '')), ''), v_sort
    );
    v_sort := v_sort + 1;
  END LOOP;

  IF v_has_kitchen THEN
    v_kt_ref := public.next_financial_ref(v_rest, 'kitchen_ticket', 'KT');
    INSERT INTO public.kitchen_tickets (restaurant_id, order_id, reference, shift_id, status)
    VALUES (v_rest, v_order_id, v_kt_ref, v_shift, 'new') RETURNING id INTO v_kt_id;
    PERFORM public.record_order_event(v_order_id, 'kitchen.sent', 'kitchen_ticket', v_kt_id,
      jsonb_build_object('reference', v_kt_ref));
  END IF;

  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,
    jsonb_build_object('reference', v_ord_ref, 'total', v_total, 'order_type', 'delivery'));

  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_ord_ref, 'total', v_total);
END; $$;

-- Continued in next section: finalize_sale refactor + context + shift report
