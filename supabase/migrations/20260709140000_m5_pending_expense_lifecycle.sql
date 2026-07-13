-- M5: Pending expense lifecycle (align with collection approval) + driver audit fix
-- Root cause of INSUFFICIENT_FUNDS: pos_record_expense checked treasury_balance (approved
-- ledger only) and posted ledger immediately. Cashier must use operational drawer balance
-- and create pending expenses with no ledger write until manager approval.

-- ---------------------------------------------------------------------------
-- 1) Audit allowlist: delivery drivers + order driver events
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
    'customer.created', 'customer.updated',
    'delivery_driver.created', 'delivery_driver.updated'
  )
);

-- ---------------------------------------------------------------------------
-- 2) Operational drawer = approved ledger + pending cash − pending expenses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m5b_operational_treasury_balance(p_treasury_id uuid, p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.treasury_balance(p_treasury_id)
    + coalesce((
        SELECT sum(
          CASE
            WHEN pm.code = 'cash' THEN op.amount - op.change_given
            ELSE 0
          END
        )
        FROM public.order_payments op
        JOIN public.payment_methods pm ON pm.id = op.payment_method_id
        WHERE op.shift_id = p_shift_id
          AND op.collection_status = 'pending'
          AND op.treasury_id = p_treasury_id
      ), 0)
    - coalesce((
        SELECT sum(e.amount)
        FROM public.expenses e
        WHERE e.shift_id = p_shift_id
          AND e.treasury_id = p_treasury_id
          AND e.status = 'pending'
      ), 0);
$$;

CREATE OR REPLACE FUNCTION public.m5b_pending_expenses_summary(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_total numeric;
  v_by_cat jsonb;
BEGIN
  SELECT count(*)::int, coalesce(sum(e.amount), 0)
  INTO v_count, v_total
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.status = 'pending';

  SELECT coalesce(jsonb_agg(row ORDER BY category), '[]'::jsonb) INTO v_by_cat
  FROM (
    SELECT e.category::text AS category,
      jsonb_build_object(
        'category', e.category,
        'count', count(*)::int,
        'amount', coalesce(sum(e.amount), 0)
      ) AS row
    FROM public.expenses e
    WHERE e.shift_id = p_shift_id AND e.status = 'pending'
    GROUP BY e.category
  ) sub;

  RETURN jsonb_build_object(
    'count', coalesce(v_count, 0),
    'amount', coalesce(v_total, 0),
    'by_category', v_by_cat
  );
END; $$;

-- ---------------------------------------------------------------------------
-- 3) Cashier expense → pending only (no ledger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_record_expense(
  p_amount numeric,
  p_category public.expense_category DEFAULT 'petty_cash',
  p_description text DEFAULT NULL,
  p_vendor text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift uuid;
  v_drawer uuid;
  v_exp uuid;
  v_ref text;
  v_op_bal numeric;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true AND is_active = true;
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;

  v_op_bal := public.m5b_operational_treasury_balance(v_drawer, v_shift);
  IF v_op_bal < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'expense', 'EXP');
  INSERT INTO public.expenses
    (restaurant_id, reference, shift_id, treasury_id, category, amount, description, vendor,
     status, created_by, auto_approved)
  VALUES (v_rest, v_ref, v_shift, v_drawer, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'pending', v_actor, false)
  RETURNING id INTO v_exp;

  PERFORM public.log_audit_event(v_rest, 'expense.created', NULL, v_actor, 'expense', v_exp, NULL,
    jsonb_build_object(
      'amount', p_amount, 'reference', v_ref, 'pos_operational', true, 'status', 'pending'
    ));
  RETURN v_exp;
END; $$;

-- ---------------------------------------------------------------------------
-- 4) Approve expense: ledger write; drawer may use pending cash for coverage check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_e public.expenses%ROWTYPE;
  v_actor uuid := public.auth_staff_id();
  v_available numeric;
  v_is_drawer boolean;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_id AND restaurant_id = v_rest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_e.status <> 'pending' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  SELECT is_shift_drawer INTO v_is_drawer FROM public.treasuries WHERE id = v_e.treasury_id;

  -- Drawer + shift: coverage = operational balance with this expense added back
  -- (operational already subtracts all pending expenses including this row).
  IF coalesce(v_is_drawer, false) AND v_e.shift_id IS NOT NULL THEN
    v_available := public.m5b_operational_treasury_balance(v_e.treasury_id, v_e.shift_id)
      + v_e.amount;
  ELSE
    v_available := public.treasury_balance(v_e.treasury_id);
  END IF;

  IF v_available < v_e.amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  UPDATE public.expenses
  SET status = 'executed',
      approved_by = v_actor,
      approved_at = now(),
      executed_at = now()
  WHERE id = p_id;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_e.treasury_id, v_e.shift_id, -v_e.amount, 'expense', 'expense', p_id, v_e.reference, v_actor);

  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, v_actor,
    'expense', p_id, NULL, jsonb_build_object('amount', v_e.amount, 'reference', v_e.reference));
END; $$;

CREATE OR REPLACE FUNCTION public.list_pending_expenses_for_shift(
  p_shift_id uuid,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at)
    FROM (
      SELECT jsonb_build_object(
        'id', e.id,
        'reference', e.reference,
        'amount', e.amount,
        'category', e.category,
        'description', e.description,
        'vendor', e.vendor,
        'created_by', e.created_by,
        'created_at', e.created_at
      ) AS row, e.created_at
      FROM public.expenses e
      WHERE e.shift_id = p_shift_id AND e.status = 'pending'
      ORDER BY e.created_at
      LIMIT greatest(p_limit, 1)
      OFFSET greatest(p_offset, 0)
    ) sub
  ), '[]'::jsonb);
END; $$;

-- ---------------------------------------------------------------------------
-- 5) Shift bulk approve: collections first, then expenses
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_pending_for_shift(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
  v_exp_ids uuid[];
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
  v_count int := 0;
  v_exp_count int := 0;
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

  SELECT array_agg(e.id ORDER BY e.created_at), count(*)::int
  INTO v_exp_ids, v_exp_count
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.status = 'pending';

  IF v_exp_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_exp_ids LOOP
      PERFORM public.approve_expense(v_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'approved_count', coalesce(v_count, 0),
    'approved_expenses_count', coalesce(v_exp_count, 0)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.reject_pending_for_shift(p_shift_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_ids uuid[];
  v_exp_ids uuid[];
  v_id uuid;
  v_count int := 0;
  v_exp_count int := 0;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  SELECT array_agg(op.id ORDER BY op.created_at), count(*)::int
  INTO v_ids, v_count
  FROM public.order_payments op
  WHERE op.shift_id = p_shift_id AND op.collection_status = 'pending';

  IF v_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_ids LOOP
      PERFORM public.reject_collection(v_id, p_reason);
    END LOOP;
  END IF;

  SELECT array_agg(e.id ORDER BY e.created_at), count(*)::int
  INTO v_exp_ids, v_exp_count
  FROM public.expenses e
  WHERE e.shift_id = p_shift_id AND e.status = 'pending';

  IF v_exp_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_exp_ids LOOP
      PERFORM public.reject_expense(v_id, p_reason);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'rejected_count', coalesce(v_count, 0),
    'rejected_expenses_count', coalesce(v_exp_count, 0)
  );
END; $$;

-- ---------------------------------------------------------------------------
-- 6) Shift report: expose pending expenses KPIs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shift_report(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift public.shifts;
  v_drawer uuid;
  r record;
  v_shift_net numeric;
  v_expected numeric;
  v_actual numeric;
  v_carried numeric;
  v_pending jsonb;
  v_pending_count int;
  v_pending_amount numeric;
  v_pending_exp jsonb;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true;

  SELECT
    coalesce(sum(amount) FILTER (WHERE source = 'opening_float'), 0) AS opening_float,
    coalesce(sum(amount) FILTER (WHERE source = 'pos_payment'), 0) AS cash_sales,
    coalesce(-sum(amount) FILTER (WHERE source = 'transfer_out'), 0) AS cash_drops,
    coalesce(-sum(amount) FILTER (WHERE source = 'expense'), 0) AS expenses,
    coalesce(sum(amount) FILTER (WHERE source = 'deposit'), 0) AS deposits,
    coalesce(-sum(amount) FILTER (WHERE source = 'withdrawal'), 0) AS withdrawals,
    coalesce(sum(amount) FILTER (WHERE source = 'refund_reversal'), 0) AS refunds,
    coalesce(sum(amount) FILTER (WHERE source = 'transfer_in'), 0) AS transfers_in,
    coalesce(sum(amount) FILTER (WHERE source = 'variance'), 0) AS variance,
    coalesce(sum(amount), 0) AS balance
  INTO r
  FROM public.treasury_movements
  WHERE shift_id = p_shift_id AND treasury_id = v_drawer;

  v_shift_net := r.balance - r.variance;

  IF v_shift.status = 'closed' THEN
    v_actual := v_shift.actual_cash_count;
    v_expected := coalesce(v_shift.actual_cash_count, 0) - r.variance;
  ELSE
    v_actual := NULL;
    v_expected := public.treasury_balance(v_drawer);
  END IF;

  v_carried := v_expected - v_shift_net;
  v_pending := public.m5b_pending_collections_summary(p_shift_id);
  v_pending_count := (v_pending->>'count')::int;
  v_pending_amount := (v_pending->>'amount')::numeric;
  v_pending_exp := public.m5b_pending_expenses_summary(p_shift_id);

  RETURN jsonb_build_object(
    'id', v_shift.id, 'reference', v_shift.reference, 'status', v_shift.status,
    'opened_at', v_shift.opened_at, 'opened_by', v_shift.opened_by,
    'closed_at', v_shift.closed_at, 'actual_cash', v_actual,
    'difference_reason', v_shift.difference_reason, 'notes', v_shift.notes,
    'opening_balance', v_carried,
    'opening_float', r.opening_float, 'cash_sales', r.cash_sales,
    'cash_drops', r.cash_drops, 'expenses', r.expenses,
    'deposits', r.deposits, 'withdrawals', r.withdrawals,
    'refunds', r.refunds, 'transfers_in', r.transfers_in,
    'expected_cash', v_expected, 'variance', r.variance,
    'approved_expected_cash', v_expected,
    'operational_drawer_balance',
      CASE WHEN v_drawer IS NULL THEN NULL
      ELSE public.m5b_operational_treasury_balance(v_drawer, p_shift_id) END,
    'approved_revenue', public.m5b_shift_approved_revenue(p_shift_id),
    'pending_collections_count', v_pending_count,
    'pending_collections_amount', v_pending_amount,
    'pending_collections_summary', v_pending,
    'pending_by_payment_method', v_pending->'by_payment_method',
    'pending_expenses_count', (v_pending_exp->>'count')::int,
    'pending_expenses_amount', (v_pending_exp->>'amount')::numeric,
    'pending_expenses_summary', v_pending_exp
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.list_pending_expenses_for_shift(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m5b_pending_expenses_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_pending_for_shift(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
