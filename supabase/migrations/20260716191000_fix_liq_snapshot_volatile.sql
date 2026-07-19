-- Fix: liq_get_snapshot must be VOLATILE (may INSERT default settings).
CREATE OR REPLACE FUNCTION public.liq_get_snapshot()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_settings public.liquidity_settings%ROWTYPE;
  v_main uuid;
  v_bal numeric;
  v_res numeric;
  v_op numeric;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_settings := public.liq_ensure_settings(v_rest);
  v_main := public.main_cash_treasury_id(v_rest);
  v_bal := CASE WHEN v_main IS NULL THEN 0 ELSE public.treasury_balance(v_main) END;
  v_res := public.liq_reserved_balance(v_rest);
  IF v_res > v_bal THEN v_res := v_bal; END IF;
  v_op := round(v_bal - v_res, 2);
  RETURN jsonb_build_object(
    'treasury_id', v_main,
    'main_balance', v_bal,
    'operating_balance', v_op,
    'reserved_balance', v_res,
    'operating_pct', v_settings.operating_pct,
    'reserved_pct', v_settings.reserved_pct,
    'currency_code', 'EGP',
    'note_ar', 'تقسيم إداري للسيولة — ليس أرباحًا ولا خزنة جديدة'
  );
END;
$$;
