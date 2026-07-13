-- M4 patch: reference on variance movements (VR-000001) + ledger-computed
-- shift report (opening float, cash sales, cash drops, expenses, expected,
-- actual, variance). All values derived from the ledger — no summary tables.

ALTER TABLE public.treasury_movements ADD COLUMN IF NOT EXISTS reference text;

-- close_shift: stamp the variance movement with a VR reference -------------
CREATE OR REPLACE FUNCTION public.close_shift(
  p_actual_cash_count numeric, p_difference_reason text, p_notes text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_drawer uuid;
  v_shift uuid;
  v_expected numeric;
  v_diff numeric;
  v_ref text;
BEGIN
  IF coalesce(p_actual_cash_count, -1) < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_shift IS NULL THEN RAISE EXCEPTION 'NO_OPEN_SHIFT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true;

  v_expected := public.treasury_balance(v_drawer);
  v_diff := p_actual_cash_count - v_expected;

  IF v_diff <> 0 THEN
    IF length(trim(coalesce(p_difference_reason, ''))) = 0 THEN
      RAISE EXCEPTION 'DIFFERENCE_REASON_REQUIRED';
    END IF;
    v_ref := public.next_financial_ref(v_rest, 'variance', 'VR');
    INSERT INTO public.treasury_movements
      (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id,
       reference, created_by)
    VALUES (v_rest, v_drawer, v_shift, v_diff, 'variance', 'shift', v_shift, v_ref, v_actor);
  END IF;

  UPDATE public.shifts
  SET status = 'closed', closed_by = v_actor, closed_at = now(),
      actual_cash_count = p_actual_cash_count,
      difference_reason = nullif(trim(coalesce(p_difference_reason, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  WHERE id = v_shift;

  PERFORM public.log_audit_event(v_rest, 'shift.closed', NULL, v_actor, 'shift', v_shift, NULL,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash_count, 'difference', v_diff));
END; $$;

-- Ledger-computed shift report (open or closed) ---------------------------
CREATE OR REPLACE FUNCTION public.get_shift_report(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift public.shifts;
  v_drawer uuid;
  r record;
  v_expected numeric;
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

  -- Expected = drawer balance before the variance adjustment.
  v_expected := r.balance - r.variance;

  RETURN jsonb_build_object(
    'id', v_shift.id, 'reference', v_shift.reference, 'status', v_shift.status,
    'opened_at', v_shift.opened_at, 'opened_by', v_shift.opened_by,
    'closed_at', v_shift.closed_at, 'actual_cash', v_shift.actual_cash_count,
    'difference_reason', v_shift.difference_reason, 'notes', v_shift.notes,
    'opening_float', r.opening_float, 'cash_sales', r.cash_sales,
    'cash_drops', r.cash_drops, 'expenses', r.expenses,
    'deposits', r.deposits, 'withdrawals', r.withdrawals,
    'refunds', r.refunds, 'transfers_in', r.transfers_in,
    'expected_cash', v_expected, 'variance', r.variance
  );
END; $$;

-- get_open_shift now returns the full report for the open shift ------------
CREATE OR REPLACE FUNCTION public.get_open_shift()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id(); v_id uuid;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT id INTO v_id FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.get_shift_report(v_id);
END; $$;

-- Include the (mostly variance) reference in ledger rows -------------------
CREATE OR REPLACE FUNCTION public.get_treasury_ledger(p_treasury_id uuid, p_limit int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(entry ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', mv.id, 'amount', mv.amount, 'source', mv.source,
        'reference', mv.reference, 'created_at', mv.created_at,
        'created_by', s.display_name
      ) AS entry, mv.created_at
      FROM public.treasury_movements mv
      LEFT JOIN public.staff s ON s.id = mv.created_by
      WHERE mv.treasury_id = p_treasury_id AND mv.restaurant_id = v_rest
      ORDER BY mv.created_at DESC
      LIMIT coalesce(p_limit, 100)
    ) sub
  ), '[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_shift_report(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
