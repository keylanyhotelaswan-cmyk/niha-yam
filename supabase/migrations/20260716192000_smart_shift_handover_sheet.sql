-- Smart shift handover sheet + review-only approval (does not block cashier).
-- Path A (to_main): auto-execute money transfer on close; manager review is separate.
-- Path B (to_next_shift): money receive on next open unchanged.
-- No impact on liquidity operating balance from review actions.

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS chk_audit_log_m1_actions;
ALTER TABLE public.audit_log ADD CONSTRAINT chk_audit_log_m1_actions CHECK (
  action IN (
    'auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_reset_requested', 'auth.signup_completed',
    'auth.pin_login', 'auth.pin_login_failed',
    'staff.invited', 'staff.created', 'staff.updated', 'staff.deactivated', 'staff.reactivated',
    'staff.password_changed', 'staff.pin_set', 'staff.pin_verify_failed', 'staff.owner_bootstrapped',
    'menu.category_created', 'menu.category_updated', 'menu.category_status_changed',
    'menu.item_created', 'menu.item_updated', 'menu.item_status_changed',
    'menu.modifier_group_created', 'menu.modifier_group_updated', 'menu.modifier_group_status_changed',
    'menu.modifier_option_created', 'menu.modifier_option_updated', 'menu.modifier_option_status_changed',
    'menu.item_modifiers_linked',
    'treasury.created', 'treasury.updated', 'treasury.status_changed',
    'payment_method.updated', 'payment_method.mapping_changed', 'payment_method.status_changed',
    'shift.opened', 'shift.closed',
    'transfer.created', 'transfer.approved', 'transfer.rejected', 'transfer.executed', 'transfer.reversed',
    'cash_drop.executed',
    'expense.created', 'expense.approved', 'expense.rejected', 'expense.executed', 'expense.reversed',
    'adjustment.created', 'adjustment.approved', 'adjustment.rejected', 'adjustment.executed', 'adjustment.reversed',
    'order.finalized', 'order.created', 'order.amended', 'order.fulfillment_updated', 'order.cancelled',
    'order.collection_recorded', 'order.collection_approved', 'order.collection_rejected', 'order.collection_reversed',
    'order.reprinted', 'order.edited', 'order.review_flagged', 'order.review_cleared',
    'order.driver_assigned', 'order.driver_changed',
    'kitchen.ticket_created', 'print.job_enqueued',
    'print.job_claimed', 'print.job_completed', 'print.job_failed', 'print.job_retried',
    'print.job_cancelled', 'print.job_again', 'print.test_enqueued',
    'printer.created', 'printer.updated', 'printer.status_changed',
    'print_bridge.heartbeat',
    'customer.created', 'customer.updated',
    'delivery_driver.created', 'delivery_driver.updated',
    'recipes.uom_created', 'recipes.uom_conversion_upserted',
    'recipes.ingredient_upserted', 'recipes.ingredient_cost_changed',
    'recipes.recipe_upserted', 'recipes.recipe_status_changed',
    'inventory.location_upserted', 'inventory.movement_posted', 'inventory.movement_reversed',
    'inventory.settings_upserted',
    'handover.created', 'handover.received', 'handover.rejected', 'handover.re_requested',
    'handover.reviewed',
    'ops_feedback.created', 'ops_feedback.status',
    'purchase.supplier_upserted', 'purchase.supplier_status_changed',
    'purchase.direct_posted', 'purchase.direct_reversed',
    'purchase.credit_posted', 'purchase.credit_reversed',
    'purchase.supplier_payment_posted', 'purchase.supplier_payment_reversed',
    'liquidity.settings_updated', 'liquidity.revenue_split', 'liquidity.released'
  )
);

-- ---------------------------------------------------------------------------
-- Review columns (manager sign-off — not a money gate)
-- ---------------------------------------------------------------------------
ALTER TABLE public.shift_handovers
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON COLUMN public.shift_handovers.review_status IS
  'Manager review only — does not move money or block cashier ops';

-- ---------------------------------------------------------------------------
-- close_shift: Path A auto-executes transfer so cashier is done
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_shift(
  p_actual_cash_count numeric,
  p_difference_reason text,
  p_notes text,
  p_destination text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_safe uuid;
  v_shift uuid;
  v_expected numeric;
  v_diff numeric;
  v_vr text;
  v_amount numeric;
  v_kind public.shift_handover_kind;
  v_ref text;
  v_hid uuid;
  v_cashier text;
  v_transfer uuid;
  v_cd text;
  v_status public.shift_handover_status := 'pending';
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF coalesce(p_actual_cash_count, -1) < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_destination NOT IN ('to_main', 'to_next_shift') THEN RAISE EXCEPTION 'INVALID_DESTINATION'; END IF;
  v_kind := p_destination::public.shift_handover_kind;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_handovers WHERE shift_id = v_shift AND status = 'pending'
  ) THEN RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING'; END IF;

  v_drawer := public.drawer_treasury_id(v_rest);
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  v_expected := public.treasury_balance(v_drawer);
  v_diff := p_actual_cash_count - v_expected;

  IF v_diff <> 0 THEN
    IF length(trim(coalesce(p_difference_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'DIFFERENCE_REASON_REQUIRED';
    END IF;
    v_vr := public.next_financial_ref(v_rest, 'variance', 'VR');
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_diff, 'variance', 'shift', v_shift, v_vr, v_actor);
  END IF;

  UPDATE public.shifts
  SET status = 'closed', closed_by = v_actor, closed_at = now(),
      actual_cash_count = p_actual_cash_count,
      difference_reason = nullif(trim(coalesce(p_difference_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = v_shift;

  v_amount := public.treasury_balance(v_drawer);
  v_ref := public.next_financial_ref(v_rest, 'handover', 'HO');

  INSERT INTO public.shift_handovers
    (restaurant_id, reference, shift_id, kind, amount, status, created_by, review_status)
  VALUES (v_rest, v_ref, v_shift, v_kind, v_amount, 'pending', v_actor, 'pending')
  RETURNING id INTO v_hid;

  -- Path A: move cash to Main immediately (cashier finished). Review stays pending.
  IF v_kind = 'to_main' AND v_amount > 0 THEN
    v_safe := public.main_cash_treasury_id(v_rest);
    IF v_safe IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;
    PERFORM 1 FROM public.treasuries WHERE id = v_drawer FOR UPDATE;
    PERFORM 1 FROM public.treasuries WHERE id = v_safe FOR UPDATE;
    IF public.treasury_balance(v_drawer) < v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

    v_cd := public.next_financial_ref(v_rest, 'cash_drop', 'CD');
    INSERT INTO public.treasury_transfers
      (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
       is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
    VALUES (v_rest, v_cd, v_shift, v_drawer, v_safe, v_amount,
       'Shift handover ' || v_ref,
       true, 'executed', v_actor, v_actor, now(), now(), true)
    RETURNING id INTO v_transfer;

    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by,
       source_ref_type, source_ref_id)
    VALUES
      (v_rest, v_drawer, v_shift, -v_amount, 'transfer_out', v_transfer, v_ref, v_actor,
       'shift_handover', v_hid),
      (v_rest, v_safe, v_shift, v_amount, 'transfer_in', v_transfer, v_ref, v_actor,
       'shift_handover', v_hid);

    UPDATE public.shift_handovers
    SET status = 'executed', received_by = v_actor, received_at = now(), transfer_id = v_transfer
    WHERE id = v_hid;
    v_status := 'executed';

    PERFORM public.log_audit_event(v_rest, 'handover.received', NULL, v_actor, 'shift_handover', v_hid, NULL,
      jsonb_build_object('kind', 'to_main', 'amount', v_amount, 'reference', v_ref,
        'transfer_id', v_transfer, 'auto_on_close', true));
  ELSIF v_kind = 'to_main' AND v_amount = 0 THEN
    UPDATE public.shift_handovers
    SET status = 'executed', received_by = v_actor, received_at = now()
    WHERE id = v_hid;
    v_status := 'executed';
  END IF;

  SELECT display_name INTO v_cashier FROM public.staff WHERE id = v_actor;

  PERFORM public.log_audit_event(v_rest, 'shift.closed', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash_count, 'difference', v_diff,
      'destination', p_destination, 'handover_id', v_hid, 'handover_ref', v_ref,
      'auto_executed', v_status = 'executed'));
  PERFORM public.log_audit_event(v_rest, 'handover.created', NULL, v_actor, 'shift_handover', v_hid, NULL,
    jsonb_build_object('kind', p_destination, 'amount', v_amount, 'reference', v_ref, 'shift_id', v_shift,
      'status', v_status));

  RETURN jsonb_build_object(
    'shift_id', v_shift, 'handover_id', v_hid, 'reference', v_ref,
    'kind', p_destination, 'amount', v_amount,
    'cashier_name', coalesce(v_cashier, ''), 'status', v_status,
    'review_status', 'pending',
    'auto_executed', v_status = 'executed'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Manager review (no money movement)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_shift_handover(
  p_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_h public.shift_handovers%ROWTYPE;
  v_decision text := lower(trim(coalesce(p_decision, '')));
BEGIN
  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  SELECT * INTO v_h FROM public.shift_handovers
  WHERE id = p_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  UPDATE public.shift_handovers SET
    review_status = v_decision,
    review_notes = nullif(trim(coalesce(p_notes, '')), ''),
    reviewed_by = v_actor,
    reviewed_at = now()
  WHERE id = p_id;

  PERFORM public.log_audit_event(
    v_rest, 'handover.reviewed', NULL, v_actor, 'shift_handover', p_id, NULL,
    jsonb_build_object(
      'decision', v_decision,
      'notes', nullif(trim(coalesce(p_notes, '')), ''),
      'reference', v_h.reference,
      'money_status', v_h.status
    )
  );

  RETURN jsonb_build_object(
    'handover_id', p_id,
    'review_status', v_decision,
    'money_status', v_h.status,
    'reference', v_h.reference
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Smart one-page handover sheet
-- ---------------------------------------------------------------------------
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
      AND o.status::text NOT IN ('voided')
    GROUP BY oi.name
    ORDER BY sum(oi.line_total) DESC
    LIMIT 10
  ) x;

  SELECT count(*)::int INTO v_cancelled
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest AND o.status = 'voided';

  SELECT coalesce(sum(coalesce(o.discount_amount, 0)), 0) INTO v_discount
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest
    AND o.status NOT IN ('voided');

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

GRANT EXECUTE ON FUNCTION public.review_shift_handover(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_smart_shift_sheet(uuid) TO authenticated;
