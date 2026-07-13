-- M4 fix: make the shift report's Expected Cash consistent with close_shift.
-- close_shift reconciles the counted cash against the *cumulative* drawer
-- balance (cash carries across shifts; there is no auto-sweep). The report must
-- report the same expected value, or the UI would disagree with the variance.
--   * Open shift   → expected = current drawer balance.
--   * Closed shift → expected = actual_cash_count − variance (the value it was
--                    reconciled against at close; stable for history).
-- We also expose `opening_balance` (cash carried into the shift) so the
-- breakdown always reconciles: expected = carried + float + sales − drops − …

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

  -- Net drawer flow during this shift, excluding the variance adjustment.
  v_shift_net := r.balance - r.variance;

  IF v_shift.status = 'closed' THEN
    v_actual := v_shift.actual_cash_count;
    v_expected := coalesce(v_shift.actual_cash_count, 0) - r.variance;
  ELSE
    v_actual := NULL;
    v_expected := public.treasury_balance(v_drawer);
  END IF;

  -- Cash carried into the shift so the breakdown reconciles to Expected.
  v_carried := v_expected - v_shift_net;

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
    'expected_cash', v_expected, 'variance', r.variance
  );
END; $$;

NOTIFY pgrst, 'reload schema';
