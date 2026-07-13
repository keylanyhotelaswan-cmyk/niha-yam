-- Operational Completion v1.1
-- Receive cash-count · Orders Hub shift scope · Order identity · remote_operator · ops messages

-- Drop prior overloads before replacing signatures
DROP FUNCTION IF EXISTS public.open_shift(numeric, uuid);
DROP FUNCTION IF EXISTS public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int);

-- =============================================================================
-- OC-1: Receive cash count on Path B
-- =============================================================================
ALTER TABLE public.shift_handovers
  ADD COLUMN IF NOT EXISTS received_actual_cash numeric(12,2),
  ADD COLUMN IF NOT EXISTS receive_variance numeric(12,2);

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
    WHERE id = v_pending.id;

    -- Align drawer to counted trust if receive variance ≠ 0
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

-- Enrich pending + archive with receive count fields
CREATE OR REPLACE FUNCTION public.list_pending_handovers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at)
    FROM (
      SELECT
        h.id, h.reference, h.shift_id, s.reference AS shift_reference,
        h.kind::text AS kind, h.amount, h.status::text AS status, h.created_at,
        st.display_name AS cashier_name, h.created_by,
        s.actual_cash_count,
        round(coalesce((
          SELECT sum(m.amount) FROM public.treasury_movements m
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

-- =============================================================================
-- OC-2: Orders Hub — shift scope
-- =============================================================================
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
          NOT p_hub_only
          OR o.payment_status IN ('unpaid', 'partial')
          OR o.requires_review = true
          OR o.fulfillment_status IN ('new', 'preparing', 'ready')
        )
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

-- =============================================================================
-- OC-4: Order identity
-- =============================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

CREATE OR REPLACE FUNCTION public.touch_order_edited(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.auth_staff_id();
BEGIN
  UPDATE public.orders
  SET last_edited_by = v_actor, last_edited_at = now()
  WHERE id = p_order_id;
END;
$$;

-- =============================================================================
-- OC-5: remote_operator role helpers (enum value added in 20260713149900)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.staff_role_rank(p_role public.staff_role)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 100
    WHEN 'manager' THEN 80
    WHEN 'cashier' THEN 50
    WHEN 'remote_operator' THEN 45
    WHEN 'waiter' THEN 40
    WHEN 'kitchen' THEN 30
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_remote_operator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_branches sb
    JOIN public.staff s ON s.id = sb.staff_id
    WHERE s.id = public.auth_staff_id() AND sb.role = 'remote_operator'
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_cash_ops_allowed()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_remote_operator() AND NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'REMOTE_OPERATOR_NO_CASH';
  END IF;
END;
$$;

-- =============================================================================
-- OC-6: Ops messages + print layouts (kind ops_message added in 20260713149900)
-- =============================================================================
ALTER TABLE public.print_document_layouts DROP CONSTRAINT IF EXISTS chk_print_doc_type;
ALTER TABLE public.print_document_layouts
  ADD CONSTRAINT chk_print_doc_type CHECK (
    document_type IN ('receipt', 'kitchen', 'shift_report', 'shift_handover', 'ops_message')
  );

CREATE TABLE IF NOT EXISTS public.ops_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  reference text NOT NULL,
  body text NOT NULL,
  target_role text, -- cashier | kitchen | remote_operator | all
  target_station text, -- free label e.g. POS-1
  print_job_id uuid REFERENCES public.print_jobs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_messages_rest_created
  ON public.ops_messages (restaurant_id, created_at DESC);

ALTER TABLE public.ops_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_messages_select ON public.ops_messages;
CREATE POLICY ops_messages_select ON public.ops_messages FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
DROP POLICY IF EXISTS ops_messages_insert ON public.ops_messages;
CREATE POLICY ops_messages_insert ON public.ops_messages FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());
DROP POLICY IF EXISTS ops_messages_update ON public.ops_messages;
CREATE POLICY ops_messages_update ON public.ops_messages FOR UPDATE TO authenticated
  USING (restaurant_id = public.auth_restaurant_id())
  WITH CHECK (restaurant_id = public.auth_restaurant_id());

CREATE OR REPLACE FUNCTION public.send_ops_message(
  p_body text,
  p_target_role text DEFAULT 'cashier',
  p_target_station text DEFAULT NULL,
  p_print boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_ref text;
  v_pj uuid;
  v_printer_id uuid;
  v_bridge_id uuid;
  v_printer public.printers%ROWTYPE;
  v_payload jsonb;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF nullif(trim(coalesce(p_body, '')), '') IS NULL THEN RAISE EXCEPTION 'INVALID_NAME'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'ops_message', 'OM');
  INSERT INTO public.ops_messages (restaurant_id, reference, body, target_role, target_station, created_by)
  VALUES (v_rest, v_ref, trim(p_body), nullif(trim(coalesce(p_target_role, '')), ''),
          nullif(trim(coalesce(p_target_station, '')), ''), v_actor)
  RETURNING id INTO v_id;

  IF p_print THEN
    v_printer_id := public.m6_default_printer_for_role(v_rest,
      CASE WHEN p_target_role = 'kitchen' THEN 'kitchen'::public.printer_role
           ELSE 'cashier'::public.printer_role END);
    IF v_printer_id IS NOT NULL THEN
      SELECT * INTO v_printer FROM public.printers WHERE id = v_printer_id AND is_active;
      IF FOUND THEN
        IF v_printer.bridge_id IS NOT NULL THEN
          SELECT id INTO v_bridge_id FROM public.print_bridges
          WHERE id = v_printer.bridge_id AND restaurant_id = v_rest AND is_active;
        END IF;
        IF v_bridge_id IS NULL THEN
          SELECT id INTO v_bridge_id FROM public.print_bridges
          WHERE restaurant_id = v_rest AND is_active
          ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1;
        END IF;
        IF v_bridge_id IS NOT NULL THEN
          v_payload := jsonb_build_object(
            'data_snapshot', jsonb_build_object(
              'document_type', 'ops_message',
              'title_ar', 'رسالة تشغيلية',
              'body', trim(p_body),
              'target_role', p_target_role,
              'target_station', p_target_station,
              'reference', v_ref,
              'printed_at', now(),
              'currency_label', 'ج.م'
            ),
            'document_type', 'ops_message',
            'windows_printer_name', v_printer.address->>'windows_printer_name'
          );
          INSERT INTO public.print_jobs (
            restaurant_id, order_id, reference, kind, status, printer_id, bridge_id, payload
          ) VALUES (
            v_rest, NULL, public.next_financial_ref(v_rest, 'print_job', 'PJ'),
            'ops_message', 'pending', v_printer_id, v_bridge_id, v_payload
          ) RETURNING id INTO v_pj;
          UPDATE public.ops_messages SET print_job_id = v_pj WHERE id = v_id;
        END IF;
      END IF;
    END IF;
  END IF;

  PERFORM public.log_audit_event(v_rest, 'print.test_enqueued', NULL, v_actor, 'ops_message', v_id, NULL,
    jsonb_build_object('reference', v_ref, 'print', p_print));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ops_messages(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT m.id, m.reference, m.body, m.target_role, m.target_station,
        m.created_at, m.acknowledged_at, m.print_job_id,
        s.display_name AS created_by_name
      FROM public.ops_messages m
      LEFT JOIN public.staff s ON s.id = m.created_by
      WHERE m.restaurant_id = v_rest
      ORDER BY m.created_at DESC
      LIMIT LEAST(coalesce(p_limit, 50), 200)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_ops_message(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  UPDATE public.ops_messages
  SET acknowledged_at = now(), acknowledged_by = v_actor
  WHERE id = p_id AND restaurant_id = v_rest AND acknowledged_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_shift(numeric, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_orders_for_pos(date, text, text, text, uuid, uuid, text, boolean, int, int, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_order_edited(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_remote_operator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_cash_ops_allowed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_ops_message(text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ops_messages(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_ops_message(uuid) TO authenticated;

-- Realtime publication (ignore if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.order_payments;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_handovers;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_messages;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

-- Block remote_operator from recording collections
CREATE OR REPLACE FUNCTION public.trg_block_remote_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_remote_operator() AND NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'REMOTE_OPERATOR_NO_CASH';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_payments_block_remote ON public.order_payments;
CREATE TRIGGER trg_order_payments_block_remote
  BEFORE INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_remote_cash();

-- Enrich get_order_detail with identity
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
      'dine_in_table_ref', v_order.dine_in_table_ref,
      'delivery_driver_id', v_order.delivery_driver_id,
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
      'can_free_edit', NOT public.m5c_order_has_approved_collection(p_order_id)
    ),
    'money', v_money,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oi.id, 'name', oi.name, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total, 'line_note', oi.line_note,
        'menu_item_id', oi.menu_item_id
      ) ORDER BY oi.sort_order)
      FROM public.order_items oi WHERE oi.order_id = p_order_id
    ), '[]'::jsonb),
    'collections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', op.id,
        'reference', op.reference,
        'amount', op.amount,
        'change_given', op.change_given,
        'net_amount', op.net_amount,
        'collection_status', op.collection_status,
        'payment_method_id', op.payment_method_id,
        'payment_method_code', pm.code,
        'payment_method_name', pm.name,
        'created_at', op.created_at,
        'created_by', op.created_by,
        'collected_by_name', cs.display_name,
        'approved_at', op.approved_at,
        'rejection_reason', op.rejection_reason
      ) ORDER BY op.created_at)
      FROM public.order_payments op
      JOIN public.payment_methods pm ON pm.id = op.payment_method_id
      LEFT JOIN public.staff cs ON cs.id = op.created_by
      WHERE op.order_id = p_order_id
    ), '[]'::jsonb),
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
        WHERE op.order_id = p_order_id
          AND op.collection_status IN ('pending', 'approved')
        GROUP BY op.payment_method_id
      ) sub
      JOIN public.payment_methods pm ON pm.id = sub.payment_method_id
    ), '[]'::jsonb),
    'timeline', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'label', coalesce(e.payload->>'label_ar', public.m5c_timeline_label(e.event_type, e.payload)),
        'actor_id', e.actor_id,
        'entity_type', e.entity_type,
        'entity_id', e.entity_id,
        'payload', e.payload,
        'created_at', e.created_at
      ) ORDER BY e.created_at)
      FROM public.order_events e WHERE e.order_id = p_order_id
    ), '[]'::jsonb)
  );
END;
$$;
