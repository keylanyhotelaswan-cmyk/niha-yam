-- M5: POS operational tools (cashier) + profile username + extended context.

CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_branches jsonb;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'branch_id', sb.branch_id,
      'role', sb.role,
      'branch_name', b.name,
      'branch_code', b.code
    )
  ), '[]'::jsonb)
  INTO v_branches
  FROM public.staff_branches sb
  JOIN public.branches b ON b.id = sb.branch_id
  WHERE sb.staff_id = v_staff.id;

  RETURN jsonb_build_object(
    'id', v_staff.id,
    'user_id', v_staff.user_id,
    'restaurant_id', v_staff.restaurant_id,
    'username', v_staff.username,
    'display_name', v_staff.display_name,
    'is_active', v_staff.is_active,
    'branches', v_branches
  );
END; $$;

-- Auto-approved transfer between drawer and digital treasuries (cashier ops).
CREATE OR REPLACE FUNCTION public.pos_operational_transfer(
  p_source_treasury_id uuid,
  p_dest_treasury_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift uuid;
  v_src_drawer boolean;
  v_dst_drawer boolean;
  v_src_ok boolean;
  v_dst_ok boolean;
  v_transfer uuid;
  v_ref text;
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_source_treasury_id = p_dest_treasury_id THEN RAISE EXCEPTION 'SAME_TREASURY'; END IF;

  SELECT
    t.is_shift_drawer OR EXISTS (
      SELECT 1 FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.treasury_id = t.id
        AND pm.is_active = true AND pm.code IN ('instapay', 'ewallet')
    ),
    t.is_shift_drawer
  INTO v_src_ok, v_src_drawer
  FROM public.treasuries t
  WHERE t.id = p_source_treasury_id AND t.restaurant_id = v_rest AND t.is_active = true;
  IF NOT FOUND OR NOT v_src_ok THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;

  SELECT
    t.is_shift_drawer OR EXISTS (
      SELECT 1 FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.treasury_id = t.id
        AND pm.is_active = true AND pm.code IN ('instapay', 'ewallet')
    ),
    t.is_shift_drawer
  INTO v_dst_ok, v_dst_drawer
  FROM public.treasuries t
  WHERE t.id = p_dest_treasury_id AND t.restaurant_id = v_rest AND t.is_active = true;
  IF NOT FOUND OR NOT v_dst_ok THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;
  IF v_src_drawer = v_dst_drawer THEN RAISE EXCEPTION 'TRANSFER_NOT_ALLOWED'; END IF;

  IF public.treasury_balance(p_source_treasury_id) < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;

  v_ref := public.next_financial_ref(v_rest, 'transfer', 'TR');
  INSERT INTO public.treasury_transfers
    (restaurant_id, reference, shift_id, source_treasury_id, dest_treasury_id, amount, reason,
     is_cash_drop, status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, p_source_treasury_id, p_dest_treasury_id, p_amount,
    nullif(trim(coalesce(p_reason, '')), ''), false, 'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_transfer;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, transfer_id, reference, created_by)
  VALUES
    (v_rest, p_source_treasury_id, v_shift, -p_amount, 'transfer_out', v_transfer, v_ref, v_actor),
    (v_rest, p_dest_treasury_id, v_shift, p_amount, 'transfer_in', v_transfer, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'transfer.executed', NULL, v_actor, 'treasury_transfer',
    v_transfer, NULL, jsonb_build_object('amount', p_amount, 'reference', v_ref, 'pos_operational', true));
  RETURN v_transfer;
END; $$;

-- Auto-approved petty expense from shift drawer (cashier ops).
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
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_shift := public.pos_require_open_shift(v_rest);
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO v_drawer FROM public.treasuries
  WHERE restaurant_id = v_rest AND is_shift_drawer = true AND is_active = true;
  IF v_drawer IS NULL THEN RAISE EXCEPTION 'NO_CASH_DRAWER'; END IF;
  IF public.treasury_balance(v_drawer) < p_amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'expense', 'EXP');
  INSERT INTO public.expenses
    (restaurant_id, reference, shift_id, treasury_id, category, amount, description, vendor,
     status, created_by, approved_by, approved_at, executed_at, auto_approved)
  VALUES (v_rest, v_ref, v_shift, v_drawer, p_category, p_amount,
    nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_vendor, '')), ''),
    'executed', v_actor, v_actor, now(), now(), true)
  RETURNING id INTO v_exp;

  INSERT INTO public.treasury_movements
    (restaurant_id, treasury_id, shift_id, amount, source, source_ref_type, source_ref_id, reference, created_by)
  VALUES (v_rest, v_drawer, v_shift, -p_amount, 'expense', 'expense', v_exp, v_ref, v_actor);

  PERFORM public.log_audit_event(v_rest, 'expense.executed', NULL, v_actor, 'expense', v_exp, NULL,
    jsonb_build_object('amount', p_amount, 'reference', v_ref, 'pos_operational', true));
  RETURN v_exp;
END; $$;

CREATE OR REPLACE FUNCTION public.get_pos_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_shift uuid;
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT id INTO v_shift FROM public.shifts WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  RETURN jsonb_build_object(
    'open_shift', CASE WHEN v_shift IS NULL THEN NULL ELSE public.get_shift_report(v_shift) END,
    'payment_methods', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pm.id, 'name', pm.name, 'code', pm.code,
        'treasury_id', pm.treasury_id, 'sort_order', pm.sort_order
      ) ORDER BY pm.sort_order)
      FROM public.payment_methods pm
      WHERE pm.restaurant_id = v_rest AND pm.is_active = true AND pm.treasury_id IS NOT NULL
    ), '[]'::jsonb),
    'operational_treasuries', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'code',
          CASE
            WHEN t.is_shift_drawer THEN 'drawer'
            WHEN pm.code IS NOT NULL THEN pm.code
            ELSE 'other'
          END,
        'balance', public.treasury_balance(t.id)
      ) ORDER BY t.sort_order)
      FROM public.treasuries t
      LEFT JOIN public.payment_methods pm ON pm.treasury_id = t.id AND pm.restaurant_id = v_rest
      WHERE t.restaurant_id = v_rest AND t.is_active = true
        AND (t.is_shift_drawer = true OR pm.code IN ('instapay', 'ewallet'))
    ), '[]'::jsonb),
    'can_discount', public.pos_staff_can_discount(),
    'can_open_shift', public.is_owner_or_manager()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.pos_operational_transfer(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_record_expense(numeric, public.expense_category, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
