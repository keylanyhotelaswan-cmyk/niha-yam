-- Liquidity management: administrative operating / reserved split on Main cash.
-- No new treasury. Does not change accounting ledger semantics.
-- Revenue split fires when cash enters Main via handover receive or cash drop.
-- Operating spends: expense approve (Main), cash purchase, supplier payment.

-- ---------------------------------------------------------------------------
-- Audit allowlist
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
    'ops_feedback.created', 'ops_feedback.status',
    'purchase.supplier_upserted', 'purchase.supplier_status_changed',
    'purchase.direct_posted', 'purchase.direct_reversed',
    'purchase.credit_posted', 'purchase.credit_reversed',
    'purchase.supplier_payment_posted', 'purchase.supplier_payment_reversed',
    'liquidity.settings_updated', 'liquidity.revenue_split', 'liquidity.released'
  )
);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.liquidity_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE CASCADE,
  operating_pct numeric(5, 2) NOT NULL DEFAULT 70
    CHECK (operating_pct >= 0 AND operating_pct <= 100),
  reserved_pct numeric(5, 2) NOT NULL DEFAULT 30
    CHECK (reserved_pct >= 0 AND reserved_pct <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  CONSTRAINT chk_liquidity_pct_sum CHECK (operating_pct + reserved_pct = 100)
);

CREATE TABLE IF NOT EXISTS public.liquidity_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id),
  amount numeric(14, 2) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('revenue_split', 'release_to_operating', 'adjustment')),
  reason text,
  source_ref_type text,
  source_ref_id uuid,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_liquidity_alloc_nonzero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_liquidity_alloc_rest_created
  ON public.liquidity_allocations (restaurant_id, created_at DESC);

ALTER TABLE public.liquidity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidity_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liquidity_settings_select ON public.liquidity_settings;
CREATE POLICY liquidity_settings_select ON public.liquidity_settings
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

DROP POLICY IF EXISTS liquidity_allocations_select ON public.liquidity_allocations;
CREATE POLICY liquidity_allocations_select ON public.liquidity_allocations
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liq_ensure_settings(p_rest uuid)
RETURNS public.liquidity_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.liquidity_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.liquidity_settings WHERE restaurant_id = p_rest;
  IF FOUND THEN RETURN v_row; END IF;
  INSERT INTO public.liquidity_settings (restaurant_id, operating_pct, reserved_pct)
  VALUES (p_rest, 70, 30)
  ON CONFLICT (restaurant_id) DO NOTHING;
  SELECT * INTO v_row FROM public.liquidity_settings WHERE restaurant_id = p_rest;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.liq_reserved_balance(p_rest uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(sum(amount), 0)::numeric(14, 2)
  FROM public.liquidity_allocations
  WHERE restaurant_id = p_rest;
$$;

CREATE OR REPLACE FUNCTION public.liq_operating_balance(p_rest uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_main uuid := public.main_cash_treasury_id(p_rest);
  v_bal numeric;
  v_res numeric;
BEGIN
  IF v_main IS NULL THEN RETURN 0; END IF;
  v_bal := public.treasury_balance(v_main);
  v_res := public.liq_reserved_balance(p_rest);
  -- Never report reserved above physical Main cash
  IF v_res > v_bal THEN v_res := v_bal; END IF;
  RETURN round(v_bal - v_res, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.liq_is_main_cash(p_treasury_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.treasuries t
    WHERE t.id = p_treasury_id
      AND t.id = public.main_cash_treasury_id(t.restaurant_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.liq_require_operating_funds(
  p_treasury_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid;
  v_op numeric;
BEGIN
  IF p_treasury_id IS NULL OR coalesce(p_amount, 0) <= 0 THEN RETURN; END IF;
  IF NOT public.liq_is_main_cash(p_treasury_id) THEN RETURN; END IF;
  SELECT restaurant_id INTO v_rest FROM public.treasuries WHERE id = p_treasury_id;
  IF v_rest IS NULL THEN RETURN; END IF;
  PERFORM public.liq_ensure_settings(v_rest);
  v_op := public.liq_operating_balance(v_rest);
  IF v_op < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_OPERATING_FUNDS';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.liq_apply_revenue_split(
  p_rest uuid,
  p_treasury_id uuid,
  p_amount numeric,
  p_source_ref_type text,
  p_source_ref_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_settings public.liquidity_settings%ROWTYPE;
  v_reserved numeric(14, 2);
  v_staff uuid := public.auth_staff_id();
BEGIN
  IF p_rest IS NULL OR p_treasury_id IS NULL OR coalesce(p_amount, 0) <= 0 THEN
    RETURN;
  END IF;
  IF p_treasury_id IS DISTINCT FROM public.main_cash_treasury_id(p_rest) THEN
    RETURN;
  END IF;
  -- Idempotent per source movement
  IF p_source_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.liquidity_allocations a
    WHERE a.restaurant_id = p_rest
      AND a.kind = 'revenue_split'
      AND a.source_ref_type = p_source_ref_type
      AND a.source_ref_id = p_source_ref_id
  ) THEN
    RETURN;
  END IF;

  v_settings := public.liq_ensure_settings(p_rest);
  v_reserved := round(p_amount * v_settings.reserved_pct / 100.0, 2);
  IF v_reserved <= 0 THEN RETURN; END IF;

  INSERT INTO public.liquidity_allocations (
    restaurant_id, treasury_id, amount, kind, reason,
    source_ref_type, source_ref_id, created_by
  ) VALUES (
    p_rest, p_treasury_id, v_reserved, 'revenue_split',
    'تقسيم إيراد تلقائي',
    p_source_ref_type, p_source_ref_id, v_staff
  );

  PERFORM public.log_audit_event(
    p_rest, 'liquidity.revenue_split', NULL, v_staff,
    'liquidity_allocation', p_source_ref_id, NULL,
    jsonb_build_object(
      'gross_amount', p_amount,
      'reserved_amount', v_reserved,
      'reserved_pct', v_settings.reserved_pct,
      'operating_pct', v_settings.operating_pct,
      'source_ref_type', p_source_ref_type
    )
  );
END;
$$;

-- Auto-split when cash lands in Main via handover / cash-drop transfer_in
CREATE OR REPLACE FUNCTION public.liq_trg_on_main_inflow()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_main uuid;
  v_is_drop boolean := false;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
  IF NEW.source IS DISTINCT FROM 'transfer_in' THEN RETURN NEW; END IF;

  v_main := public.main_cash_treasury_id(NEW.restaurant_id);
  IF v_main IS NULL OR NEW.treasury_id IS DISTINCT FROM v_main THEN
    RETURN NEW;
  END IF;

  IF NEW.source_ref_type = 'shift_handover' AND NEW.source_ref_id IS NOT NULL THEN
    PERFORM public.liq_apply_revenue_split(
      NEW.restaurant_id, NEW.treasury_id, NEW.amount,
      'shift_handover', NEW.source_ref_id
    );
    RETURN NEW;
  END IF;

  IF NEW.transfer_id IS NOT NULL THEN
    SELECT coalesce(t.is_cash_drop, false) INTO v_is_drop
    FROM public.treasury_transfers t WHERE t.id = NEW.transfer_id;
    IF v_is_drop THEN
      PERFORM public.liq_apply_revenue_split(
        NEW.restaurant_id, NEW.treasury_id, NEW.amount,
        'cash_drop', NEW.transfer_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_liq_main_inflow ON public.treasury_movements;
CREATE TRIGGER trg_liq_main_inflow
  AFTER INSERT ON public.treasury_movements
  FOR EACH ROW
  EXECUTE PROCEDURE public.liq_trg_on_main_inflow();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.liq_upsert_settings(
  p_operating_pct numeric,
  p_reserved_pct numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_op numeric(5, 2) := round(coalesce(p_operating_pct, -1), 2);
  v_res numeric(5, 2) := round(coalesce(p_reserved_pct, -1), 2);
BEGIN
  IF v_op < 0 OR v_res < 0 OR v_op > 100 OR v_res > 100 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF v_op + v_res <> 100 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  INSERT INTO public.liquidity_settings (
    restaurant_id, operating_pct, reserved_pct, updated_at, updated_by
  ) VALUES (v_rest, v_op, v_res, now(), v_staff)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    operating_pct = EXCLUDED.operating_pct,
    reserved_pct = EXCLUDED.reserved_pct,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

  PERFORM public.log_audit_event(
    v_rest, 'liquidity.settings_updated', NULL, v_staff,
    'liquidity_settings', v_rest, NULL,
    jsonb_build_object('operating_pct', v_op, 'reserved_pct', v_res)
  );

  RETURN public.liq_get_snapshot();
END;
$$;

CREATE OR REPLACE FUNCTION public.liq_release_reserved(
  p_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_staff uuid := public.auth_staff_id();
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_main uuid := public.main_cash_treasury_id(v_rest);
  v_res numeric;
  v_id uuid;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF v_main IS NULL THEN RAISE EXCEPTION 'NO_CASH_SAFE'; END IF;

  PERFORM public.liq_ensure_settings(v_rest);
  v_res := public.liq_reserved_balance(v_rest);
  IF v_amount > v_res THEN
    RAISE EXCEPTION 'INSUFFICIENT_RESERVED';
  END IF;

  INSERT INTO public.liquidity_allocations (
    restaurant_id, treasury_id, amount, kind, reason, created_by
  ) VALUES (
    v_rest, v_main, -v_amount, 'release_to_operating', trim(p_reason), v_staff
  )
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    v_rest, 'liquidity.released', NULL, v_staff,
    'liquidity_allocation', v_id, NULL,
    jsonb_build_object('amount', v_amount, 'reason', trim(p_reason))
  );

  RETURN public.liq_get_snapshot() || jsonb_build_object(
    'released_amount', v_amount,
    'allocation_id', v_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.liq_list_allocations(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r)::jsonb)
    FROM (
      SELECT
        a.id,
        a.amount,
        a.kind,
        a.reason,
        a.source_ref_type,
        a.source_ref_id,
        a.created_at,
        a.created_by
      FROM public.liquidity_allocations a
      WHERE a.restaurant_id = v_rest
      ORDER BY a.created_at DESC
      LIMIT v_limit
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liq_get_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_upsert_settings(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_release_reserved(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_list_allocations(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_operating_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_reserved_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liq_require_operating_funds(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- Gate spends from Main cash through operating balance
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

  IF coalesce(v_is_drawer, false) AND v_e.shift_id IS NOT NULL THEN
    v_available := public.m5b_operational_treasury_balance(v_e.treasury_id, v_e.shift_id)
      + v_e.amount;
  ELSE
    v_available := public.treasury_balance(v_e.treasury_id);
  END IF;

  IF v_available < v_e.amount THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  -- Main cash: also require operating bucket
  IF NOT coalesce(v_is_drawer, false) THEN
    PERFORM public.liq_require_operating_funds(v_e.treasury_id, v_e.amount);
  END IF;

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

-- Patch cash purchase: add operating gate after funds check (keep ops purchase body)
CREATE OR REPLACE FUNCTION public.pur_post_direct_cash_purchase(
  p_treasury_id uuid,
  p_source_kind text,
  p_supplier_id uuid,
  p_direct_label text,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_operational_purchase();
  v_staff uuid := public.auth_staff_id();
  v_ref text;
  v_purchase_id uuid;
  v_total numeric(14, 2) := 0;
  v_line jsonb;
  v_line_id uuid;
  v_ingredient_id uuid;
  v_qty numeric;
  v_uom_id uuid;
  v_unit_price numeric;
  v_line_total numeric(14, 2);
  v_line_notes text;
  v_mov jsonb;
  v_mov_id uuid;
  v_label text;
  v_lines_out jsonb := '[]'::jsonb;
BEGIN
  IF p_source_kind IS NULL OR p_source_kind NOT IN ('supplier', 'direct') THEN
    RAISE EXCEPTION 'INVALID_SOURCE';
  END IF;
  IF p_treasury_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.treasuries t
    WHERE t.id = p_treasury_id AND t.restaurant_id = v_rest AND t.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'LINES_REQUIRED';
  END IF;

  IF p_source_kind = 'direct' THEN
    v_label := nullif(trim(coalesce(p_direct_label, '')), '');
    IF v_label IS NULL THEN RAISE EXCEPTION 'DIRECT_LABEL_REQUIRED'; END IF;
    IF p_supplier_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
  ELSE
    IF p_supplier_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.suppliers s
      WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest AND s.is_active
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_REQUIRED';
    END IF;
    v_label := NULL;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_ingredient_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_uom_id := (v_line->>'uom_id')::uuid;
    v_unit_price := coalesce((v_line->>'unit_price')::numeric, -1);
    IF v_ingredient_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.ingredients i
      WHERE i.id = v_ingredient_id AND i.restaurant_id = v_rest AND i.is_active
    ) THEN
      RAISE EXCEPTION 'INGREDIENT_REQUIRED';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    IF v_uom_id IS NULL THEN RAISE EXCEPTION 'INVALID_UOM'; END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_line_total := round(v_qty * v_unit_price, 2);
    IF v_line_total < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
    v_total := v_total + v_line_total;
  END LOOP;

  IF v_total <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF public.treasury_balance(p_treasury_id) < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;
  PERFORM public.liq_require_operating_funds(p_treasury_id, v_total);

  v_ref := public.next_financial_ref(v_rest, 'purchase', 'PUR');

  INSERT INTO public.purchases (
    restaurant_id, reference, source_kind, supplier_id, direct_label,
    payment_method, currency_code, treasury_id, total_amount, notes,
    status, created_by, approved_by, approved_at, executed_at
  ) VALUES (
    v_rest, v_ref, p_source_kind,
    CASE WHEN p_source_kind = 'supplier' THEN p_supplier_id ELSE NULL END,
    v_label,
    'cash', 'EGP', p_treasury_id, v_total,
    nullif(trim(coalesce(p_notes, '')), ''),
    'executed', v_staff, v_staff, now(), now()
  )
  RETURNING id INTO v_purchase_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_ingredient_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_uom_id := (v_line->>'uom_id')::uuid;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_line_total := round(v_qty * v_unit_price, 2);
    v_line_notes := nullif(trim(coalesce(v_line->>'notes', '')), '');

    INSERT INTO public.purchase_lines (
      purchase_id, restaurant_id, ingredient_id, qty, uom_id,
      unit_price, line_total, notes
    ) VALUES (
      v_purchase_id, v_rest, v_ingredient_id, v_qty, v_uom_id,
      v_unit_price, v_line_total, v_line_notes
    )
    RETURNING id INTO v_line_id;

    v_mov := public.inv_post_receive_for_purchase(
      v_rest, v_staff, v_ingredient_id, v_qty, v_uom_id, v_line_id, v_ref
    );
    v_mov_id := (v_mov->>'id')::uuid;
    UPDATE public.purchase_lines SET stock_movement_id = v_mov_id WHERE id = v_line_id;

    v_lines_out := v_lines_out || jsonb_build_array(jsonb_build_object(
      'id', v_line_id,
      'ingredient_id', v_ingredient_id,
      'qty', v_qty,
      'uom_id', v_uom_id,
      'unit_price', v_unit_price,
      'line_total', v_line_total,
      'stock_movement_id', v_mov_id
    ));
  END LOOP;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, p_treasury_id, -v_total, 'purchase'::public.movement_source,
    'purchase', v_purchase_id, v_ref, v_staff
  );

  PERFORM public.log_audit_event(
    v_rest, 'purchase.direct_posted', NULL, v_staff,
    'purchase', v_purchase_id, NULL,
    jsonb_build_object(
      'reference', v_ref,
      'source_kind', p_source_kind,
      'total_amount', v_total,
      'treasury_id', p_treasury_id,
      'supplier_id', p_supplier_id,
      'direct_label', v_label
    )
  );

  RETURN jsonb_build_object(
    'id', v_purchase_id,
    'reference', v_ref,
    'total_amount', v_total,
    'status', 'executed',
    'source_kind', p_source_kind,
    'lines', v_lines_out
  );
END;
$$;

-- Supplier payment operating gate (rest of body unchanged from PURB)
CREATE OR REPLACE FUNCTION public.pur_post_supplier_payment(
  p_supplier_id uuid,
  p_treasury_id uuid,
  p_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_staff uuid := public.auth_staff_id();
  v_amount numeric(14, 2) := round(coalesce(p_amount, 0), 2);
  v_open numeric(14, 2);
  v_left numeric(14, 2);
  v_take numeric(14, 2);
  v_ref text;
  v_pay_id uuid;
  v_obl record;
  v_allocs jsonb := '[]'::jsonb;
BEGIN
  IF p_supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest AND s.is_active
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_REQUIRED';
  END IF;
  IF p_treasury_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.treasuries t
    WHERE t.id = p_treasury_id AND t.restaurant_id = v_rest AND t.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_open := public.pur_supplier_open_balance(p_supplier_id);
  IF v_amount > v_open THEN
    RAISE EXCEPTION 'OVERPAYMENT';
  END IF;
  IF public.treasury_balance(p_treasury_id) < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS';
  END IF;
  PERFORM public.liq_require_operating_funds(p_treasury_id, v_amount);

  v_ref := public.next_financial_ref(v_rest, 'supplier_payment', 'SPAY');

  INSERT INTO public.supplier_payments (
    restaurant_id, supplier_id, treasury_id, reference, amount, notes,
    status, created_by, executed_at
  ) VALUES (
    v_rest, p_supplier_id, p_treasury_id, v_ref, v_amount,
    nullif(trim(coalesce(p_notes, '')), ''),
    'executed', v_staff, now()
  )
  RETURNING id INTO v_pay_id;

  v_left := v_amount;
  FOR v_obl IN
    SELECT o.*
    FROM public.supplier_obligations o
    WHERE o.restaurant_id = v_rest
      AND o.supplier_id = p_supplier_id
      AND o.status = 'open'
      AND o.original_amount > o.allocated_amount
    ORDER BY o.created_at ASC, o.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, v_obl.original_amount - v_obl.allocated_amount);
    INSERT INTO public.supplier_payment_allocations (
      restaurant_id, payment_id, obligation_id, amount
    ) VALUES (v_rest, v_pay_id, v_obl.id, v_take);

    UPDATE public.supplier_obligations SET
      allocated_amount = allocated_amount + v_take,
      status = CASE
        WHEN allocated_amount + v_take >= original_amount THEN 'closed'
        ELSE 'open'
      END
    WHERE id = v_obl.id;

    v_allocs := v_allocs || jsonb_build_array(jsonb_build_object(
      'obligation_id', v_obl.id,
      'purchase_id', v_obl.purchase_id,
      'amount', v_take
    ));
    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0.001 THEN
    RAISE EXCEPTION 'OVERPAYMENT';
  END IF;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, p_treasury_id, -v_amount, 'supplier_payment'::public.movement_source,
    'supplier_payment', v_pay_id, v_ref, v_staff
  );

  PERFORM public.log_audit_event(
    v_rest, 'purchase.supplier_payment_posted', NULL, v_staff,
    'supplier_payment', v_pay_id, NULL,
    jsonb_build_object(
      'reference', v_ref,
      'supplier_id', p_supplier_id,
      'amount', v_amount,
      'allocations', v_allocs
    )
  );

  RETURN jsonb_build_object(
    'id', v_pay_id,
    'reference', v_ref,
    'amount', v_amount,
    'open_balance_after', public.pur_supplier_open_balance(p_supplier_id),
    'allocations', v_allocs
  );
END;
$$;
