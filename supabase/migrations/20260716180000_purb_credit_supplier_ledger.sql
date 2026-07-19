-- PURB: Credit purchase + supplier AP + payments + statement (Testing-first).
-- No PO / GRN / aging / cost feed (PURC). Cash PURA path unchanged.

-- ---------------------------------------------------------------------------
-- Audit + ledger taxonomy
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
    'purchase.supplier_payment_posted', 'purchase.supplier_payment_reversed'
  )
);

ALTER TYPE public.movement_source ADD VALUE IF NOT EXISTS 'supplier_payment';

-- ---------------------------------------------------------------------------
-- Purchases: allow credit · treasury nullable for credit
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS chk_purchases_payment_method;
ALTER TABLE public.purchases
  ADD CONSTRAINT chk_purchases_payment_method
  CHECK (payment_method IN ('cash', 'credit'));

ALTER TABLE public.purchases ALTER COLUMN treasury_id DROP NOT NULL;

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS chk_purchases_credit_treasury;
ALTER TABLE public.purchases
  ADD CONSTRAINT chk_purchases_credit_treasury CHECK (
    (payment_method = 'cash' AND treasury_id IS NOT NULL)
    OR (payment_method = 'credit' AND treasury_id IS NULL AND source_kind = 'supplier' AND supplier_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- AP obligation per credit purchase
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.purchases (id) ON DELETE RESTRICT,
  original_amount numeric(14, 2) NOT NULL,
  allocated_amount numeric(14, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  CONSTRAINT uq_supplier_obligation_purchase UNIQUE (purchase_id),
  CONSTRAINT chk_obl_amounts CHECK (
    original_amount > 0
    AND allocated_amount >= 0
    AND allocated_amount <= original_amount
  ),
  CONSTRAINT chk_obl_status CHECK (status IN ('open', 'closed', 'voided'))
);

CREATE INDEX idx_supplier_obl_supplier
  ON public.supplier_obligations (restaurant_id, supplier_id, status);

ALTER TABLE public.supplier_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_obligations_select ON public.supplier_obligations
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Supplier payments + FIFO allocations
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  notes text,
  status public.fin_status NOT NULL DEFAULT 'executed',
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  executed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supplier_payment_ref UNIQUE (restaurant_id, reference),
  CONSTRAINT chk_spay_amount CHECK (amount > 0)
);

CREATE INDEX idx_supplier_payments_supplier
  ON public.supplier_payments (restaurant_id, supplier_id, created_at DESC);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_payments_select ON public.supplier_payments
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE TABLE public.supplier_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.supplier_payments (id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL REFERENCES public.supplier_obligations (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_spay_alloc_amount CHECK (amount > 0),
  CONSTRAINT uq_spay_alloc UNIQUE (payment_id, obligation_id)
);

CREATE INDEX idx_spay_alloc_obl ON public.supplier_payment_allocations (obligation_id);

ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_payment_allocations_select ON public.supplier_payment_allocations
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_require_credit_manager()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  RETURN v_rest;
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_supplier_open_balance(p_supplier_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(o.original_amount - o.allocated_amount), 0)
  FROM public.supplier_obligations o
  WHERE o.supplier_id = p_supplier_id
    AND o.restaurant_id = public.auth_restaurant_id()
    AND o.status = 'open';
$$;

-- ---------------------------------------------------------------------------
-- Credit purchase post
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_post_credit_purchase(
  p_supplier_id uuid,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_staff uuid := public.auth_staff_id();
  v_ref text;
  v_purchase_id uuid;
  v_obl_id uuid;
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
  v_lines_out jsonb := '[]'::jsonb;
BEGIN
  IF p_supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest AND s.is_active
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_REQUIRED';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'LINES_REQUIRED';
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
    v_total := v_total + v_line_total;
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  v_ref := public.next_financial_ref(v_rest, 'purchase', 'PUR');

  INSERT INTO public.purchases (
    restaurant_id, reference, source_kind, supplier_id, direct_label,
    payment_method, currency_code, treasury_id, total_amount, notes,
    status, created_by, approved_by, approved_at, executed_at
  ) VALUES (
    v_rest, v_ref, 'supplier', p_supplier_id, NULL,
    'credit', 'EGP', NULL, v_total,
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

  INSERT INTO public.supplier_obligations (
    restaurant_id, supplier_id, purchase_id, original_amount, allocated_amount, status
  ) VALUES (
    v_rest, p_supplier_id, v_purchase_id, v_total, 0, 'open'
  )
  RETURNING id INTO v_obl_id;

  PERFORM public.log_audit_event(
    v_rest, 'purchase.credit_posted', NULL, v_staff,
    'purchase', v_purchase_id, NULL,
    jsonb_build_object(
      'reference', v_ref,
      'supplier_id', p_supplier_id,
      'total_amount', v_total,
      'obligation_id', v_obl_id,
      'payment_method', 'credit'
    )
  );

  RETURN jsonb_build_object(
    'id', v_purchase_id,
    'reference', v_ref,
    'total_amount', v_total,
    'status', 'executed',
    'source_kind', 'supplier',
    'payment_method', 'credit',
    'obligation_id', v_obl_id,
    'lines', v_lines_out
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Reverse credit purchase (blocked if any payment allocated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_reverse_credit_purchase(
  p_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_staff uuid := public.auth_staff_id();
  v_p public.purchases%ROWTYPE;
  v_obl public.supplier_obligations%ROWTYPE;
  v_line public.purchase_lines%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_p FROM public.purchases
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_p.payment_method <> 'credit' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF v_p.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  SELECT * INTO v_obl FROM public.supplier_obligations
  WHERE purchase_id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_obl.allocated_amount > 0 THEN
    RAISE EXCEPTION 'HAS_PAYMENTS';
  END IF;

  FOR v_line IN
    SELECT * FROM public.purchase_lines
    WHERE purchase_id = p_id AND restaurant_id = v_rest
  LOOP
    IF v_line.stock_movement_id IS NOT NULL THEN
      PERFORM public.inv_reverse_for_purchase(
        v_rest, v_staff, v_line.stock_movement_id, trim(p_reason)
      );
    END IF;
  END LOOP;

  UPDATE public.supplier_obligations SET
    status = 'voided',
    voided_at = now()
  WHERE id = v_obl.id;

  UPDATE public.purchases SET
    status = 'reversed',
    reversed_by = v_staff,
    reversed_at = now(),
    reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(
    v_rest, 'purchase.credit_reversed', NULL, v_staff,
    'purchase', p_id, NULL,
    jsonb_build_object('reason', trim(p_reason), 'reference', v_p.reference)
  );

  RETURN jsonb_build_object(
    'id', p_id,
    'reference', v_p.reference,
    'status', 'reversed'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Supplier payment (FIFO) + reverse
-- ---------------------------------------------------------------------------
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
      'treasury_id', p_treasury_id,
      'allocations', v_allocs
    )
  );

  RETURN jsonb_build_object(
    'id', v_pay_id,
    'reference', v_ref,
    'amount', v_amount,
    'status', 'executed',
    'supplier_id', p_supplier_id,
    'open_balance_after', public.pur_supplier_open_balance(p_supplier_id),
    'allocations', v_allocs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_reverse_supplier_payment(
  p_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_staff uuid := public.auth_staff_id();
  v_pay public.supplier_payments%ROWTYPE;
  v_alloc record;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT * INTO v_pay FROM public.supplier_payments
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_pay.status <> 'executed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

  FOR v_alloc IN
    SELECT a.*
    FROM public.supplier_payment_allocations a
    WHERE a.payment_id = p_id AND a.restaurant_id = v_rest
  LOOP
    UPDATE public.supplier_obligations SET
      allocated_amount = allocated_amount - v_alloc.amount,
      status = CASE
        WHEN status = 'voided' THEN 'voided'
        WHEN allocated_amount - v_alloc.amount <= 0 THEN 'open'
        WHEN allocated_amount - v_alloc.amount < original_amount THEN 'open'
        ELSE status
      END
    WHERE id = v_alloc.obligation_id;
  END LOOP;

  DELETE FROM public.supplier_payment_allocations
  WHERE payment_id = p_id AND restaurant_id = v_rest;

  INSERT INTO public.treasury_movements (
    restaurant_id, treasury_id, amount, source,
    source_ref_type, source_ref_id, reference, created_by
  ) VALUES (
    v_rest, v_pay.treasury_id, v_pay.amount, 'supplier_payment'::public.movement_source,
    'supplier_payment_reversal', p_id, v_pay.reference, v_staff
  );

  UPDATE public.supplier_payments SET
    status = 'reversed',
    reversed_by = v_staff,
    reversed_at = now(),
    reversal_reason = trim(p_reason)
  WHERE id = p_id;

  PERFORM public.log_audit_event(
    v_rest, 'purchase.supplier_payment_reversed', NULL, v_staff,
    'supplier_payment', p_id, NULL,
    jsonb_build_object('reason', trim(p_reason), 'reference', v_pay.reference)
  );

  RETURN jsonb_build_object(
    'id', p_id,
    'reference', v_pay.reference,
    'status', 'reversed',
    'open_balance_after', public.pur_supplier_open_balance(v_pay.supplier_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Balance + statement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pur_get_supplier_balance(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_name text;
  v_open numeric;
BEGIN
  SELECT s.name_ar INTO v_name
  FROM public.suppliers s
  WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest;
  IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_open := public.pur_supplier_open_balance(p_supplier_id);
  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id,
    'supplier_name_ar', v_name,
    'open_balance', v_open,
    'currency_code', 'EGP'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_get_supplier_statement(
  p_supplier_id uuid,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 500));
  v_name text;
  v_open numeric;
  v_rows jsonb;
BEGIN
  SELECT s.name_ar INTO v_name
  FROM public.suppliers s
  WHERE s.id = p_supplier_id AND s.restaurant_id = v_rest;
  IF v_name IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_open := public.pur_supplier_open_balance(p_supplier_id);

  WITH events AS (
    SELECT
      p.executed_at AS at,
      p.id AS doc_id,
      'credit_purchase'::text AS kind,
      p.reference,
      p.total_amount AS debit,
      0::numeric AS credit,
      p.status::text AS status
    FROM public.purchases p
    WHERE p.restaurant_id = v_rest
      AND p.supplier_id = p_supplier_id
      AND p.payment_method = 'credit'
      AND p.status IN ('executed', 'reversed')

    UNION ALL

    SELECT
      sp.executed_at,
      sp.id,
      'payment',
      sp.reference,
      0::numeric,
      sp.amount,
      sp.status::text
    FROM public.supplier_payments sp
    WHERE sp.restaurant_id = v_rest
      AND sp.supplier_id = p_supplier_id
      AND sp.status IN ('executed', 'reversed')
  ),
  ordered AS (
    SELECT *
    FROM events
    WHERE at IS NOT NULL
    ORDER BY at ASC, kind ASC, doc_id ASC
  ),
  limited AS (
    SELECT * FROM ordered
    ORDER BY at DESC, kind DESC
    LIMIT v_limit
  ),
  chron AS (
    SELECT * FROM limited
    ORDER BY at ASC, kind ASC, doc_id ASC
  ),
  running AS (
    SELECT
      c.*,
      sum(
        CASE
          WHEN c.kind = 'credit_purchase' AND c.status = 'executed' THEN c.debit
          WHEN c.kind = 'credit_purchase' AND c.status = 'reversed' THEN 0
          WHEN c.kind = 'payment' AND c.status = 'executed' THEN -c.credit
          WHEN c.kind = 'payment' AND c.status = 'reversed' THEN 0
          ELSE 0
        END
      ) OVER (ORDER BY c.at ASC, c.kind ASC, c.doc_id ASC) AS running_balance
    FROM chron c
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'at', r.at,
    'kind', r.kind,
    'doc_id', r.doc_id,
    'reference', r.reference,
    'debit', r.debit,
    'credit', r.credit,
    'status', r.status,
    'running_balance', r.running_balance,
    'label_ar', CASE
      WHEN r.kind = 'credit_purchase' AND r.status = 'executed' THEN 'شراء آجل'
      WHEN r.kind = 'credit_purchase' AND r.status = 'reversed' THEN 'عكس شراء آجل'
      WHEN r.kind = 'payment' AND r.status = 'executed' THEN 'سداد للمورد'
      WHEN r.kind = 'payment' AND r.status = 'reversed' THEN 'عكس سداد'
      ELSE r.kind
    END
  ) ORDER BY r.at DESC, r.kind DESC), '[]'::jsonb)
  INTO v_rows
  FROM running r;

  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id,
    'supplier_name_ar', v_name,
    'open_balance', v_open,
    'currency_code', 'EGP',
    'entries', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pur_list_supplier_payments(
  p_supplier_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.pur_require_credit_manager();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(r)::jsonb)
    FROM (
      SELECT
        sp.id,
        sp.reference,
        sp.supplier_id,
        s.name_ar AS supplier_name_ar,
        sp.treasury_id,
        t.name AS treasury_name,
        sp.amount,
        sp.notes,
        sp.status,
        sp.executed_at,
        sp.reversed_at,
        sp.reversal_reason,
        sp.created_at
      FROM public.supplier_payments sp
      JOIN public.suppliers s ON s.id = sp.supplier_id
      JOIN public.treasuries t ON t.id = sp.treasury_id
      WHERE sp.restaurant_id = v_rest
        AND (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
      ORDER BY sp.created_at DESC
      LIMIT v_limit
    ) r
  ), '[]'::jsonb);
END;
$$;

-- List purchases: already returns payment_method — ensure credit shows
-- (no replace needed if column selected; verify PURA list includes payment_method)

GRANT EXECUTE ON FUNCTION public.pur_require_credit_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_supplier_open_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_post_credit_purchase(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_reverse_credit_purchase(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_post_supplier_payment(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_reverse_supplier_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_get_supplier_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_get_supplier_statement(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pur_list_supplier_payments(uuid, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
