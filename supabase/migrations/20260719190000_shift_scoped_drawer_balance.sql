-- Shift-scoped drawer KPIs: summary cards must not use cumulative treasury_balance.
-- close_shift still reconciles against physical treasury_balance (unchanged).

-- ---------------------------------------------------------------------------
-- Operational balance for a treasury within one shift only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m5b_operational_treasury_balance(
  p_treasury_id uuid,
  p_shift_id uuid
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
      SELECT sum(tm.amount)
      FROM public.treasury_movements tm
      WHERE tm.shift_id = p_shift_id
        AND tm.treasury_id = p_treasury_id
    ), 0)
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

-- ---------------------------------------------------------------------------
-- get_shift_report: open-shift expected_cash = this shift only (not full drawer).
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
  v_op_drawer numeric;
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
  v_pending := public.m5b_pending_collections_summary(p_shift_id);
  v_pending_count := (v_pending->>'count')::int;
  v_pending_amount := (v_pending->>'amount')::numeric;
  v_pending_exp := public.m5b_pending_expenses_summary(p_shift_id);

  IF v_drawer IS NOT NULL THEN
    v_op_drawer := public.m5b_operational_treasury_balance(v_drawer, p_shift_id);
  ELSE
    v_op_drawer := NULL;
  END IF;

  IF v_shift.status = 'closed' THEN
    v_actual := v_shift.actual_cash_count;
    -- Historical: value reconciled at close (stable).
    v_expected := coalesce(v_shift.actual_cash_count, 0) - r.variance;
    v_carried := v_expected - v_shift_net;
    IF abs(v_carried) < 0.001 THEN
      v_carried := 0;
    END IF;
  ELSE
    v_actual := NULL;
    -- Open shift KPIs: this shift only (ledger + pending), never cumulative treasury.
    v_expected := coalesce(v_op_drawer, v_shift_net);
    v_carried := 0;
  END IF;

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
    'physical_drawer_balance', CASE
      WHEN v_drawer IS NULL THEN NULL
      ELSE public.treasury_balance(v_drawer)
    END,
    'operational_drawer_balance', v_op_drawer,
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

NOTIFY pgrst, 'reload schema';
