-- M4: Treasury & money flow schema (F1 + Multi-Treasury; single restaurant).
-- Ledger is the single source of truth: balances are always SUM(movements),
-- never stored. All writes go through SECURITY DEFINER RPCs; RLS is SELECT-only.

-- Enums -------------------------------------------------------------------
CREATE TYPE public.treasury_type AS ENUM ('cash', 'digital', 'bank');

CREATE TYPE public.fin_status AS ENUM (
  'pending', 'approved', 'rejected', 'executed', 'reversed'
);

CREATE TYPE public.movement_source AS ENUM (
  'opening_float', 'pos_payment', 'refund_reversal', 'expense',
  'withdrawal', 'deposit', 'transfer_out', 'transfer_in', 'variance'
);

CREATE TYPE public.expense_category AS ENUM (
  'petty_cash', 'supplies', 'utilities', 'salary', 'rent', 'maintenance', 'other'
);

-- Gapless per-type reference counters (rule 3) ----------------------------
CREATE TABLE public.financial_ref_counters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  ref_type text NOT NULL,
  current_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, ref_type)
);

-- Treasuries --------------------------------------------------------------
CREATE TABLE public.treasuries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  type public.treasury_type NOT NULL,
  is_shift_drawer boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_treasuries_name CHECK (length(trim(name)) > 0)
);

-- Exactly one shift drawer per restaurant.
CREATE UNIQUE INDEX uq_treasuries_shift_drawer
  ON public.treasuries (restaurant_id)
  WHERE is_shift_drawer;
CREATE INDEX idx_treasuries_restaurant ON public.treasuries (restaurant_id, sort_order);

-- Payment methods → treasury mapping (settings, not code) -----------------
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  treasury_id uuid REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_methods_code UNIQUE (restaurant_id, code)
);

-- Shifts (lightweight وردية) ----------------------------------------------
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  opened_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  closed_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  actual_cash_count numeric(14, 2),
  difference_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_shifts_status CHECK (status IN ('open', 'closed'))
);

-- At most one open shift per restaurant.
CREATE UNIQUE INDEX uq_shifts_one_open
  ON public.shifts (restaurant_id)
  WHERE status = 'open';

-- Ledger: append-only movements (SINGLE SOURCE OF TRUTH) ------------------
CREATE TABLE public.treasury_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  amount numeric(14, 2) NOT NULL,
  source public.movement_source NOT NULL,
  source_ref_type text,
  source_ref_id uuid,
  transfer_id uuid,
  reverses_movement_id uuid REFERENCES public.treasury_movements (id),
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_movement_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX idx_movements_treasury ON public.treasury_movements (treasury_id, created_at);
CREATE INDEX idx_movements_shift ON public.treasury_movements (shift_id);
CREATE INDEX idx_movements_restaurant ON public.treasury_movements (restaurant_id, created_at);
CREATE INDEX idx_movements_transfer ON public.treasury_movements (transfer_id);

-- F1 operation records (per-operation lifecycle columns — decision Q3) -----
CREATE TABLE public.treasury_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  source_treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  dest_treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  reason text,
  is_cash_drop boolean NOT NULL DEFAULT false,
  status public.fin_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  rejected_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  executed_at timestamptz,
  reversed_at timestamptz,
  rejection_reason text,
  reversal_reason text,
  reverses_id uuid REFERENCES public.treasury_transfers (id),
  auto_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_transfer_distinct CHECK (source_treasury_id <> dest_treasury_id)
);

CREATE INDEX idx_transfers_restaurant ON public.treasury_transfers (restaurant_id, created_at);
CREATE INDEX idx_transfers_status ON public.treasury_transfers (restaurant_id, status);

CREATE TABLE public.treasury_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  kind text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  reason text,
  status public.fin_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  rejected_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  executed_at timestamptz,
  reversed_at timestamptz,
  rejection_reason text,
  reversal_reason text,
  reverses_id uuid REFERENCES public.treasury_adjustments (id),
  auto_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_adjustment_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_adjustment_kind CHECK (kind IN ('deposit', 'withdrawal'))
);

CREATE INDEX idx_adjustments_restaurant ON public.treasury_adjustments (restaurant_id, created_at);
CREATE INDEX idx_adjustments_status ON public.treasury_adjustments (restaurant_id, status);

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  category public.expense_category NOT NULL,
  amount numeric(14, 2) NOT NULL,
  description text,
  vendor text,
  status public.fin_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  rejected_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  executed_at timestamptz,
  reversed_at timestamptz,
  rejection_reason text,
  reversal_reason text,
  reverses_id uuid REFERENCES public.expenses (id),
  auto_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_expense_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_expenses_restaurant ON public.expenses (restaurant_id, created_at);
CREATE INDEX idx_expenses_status ON public.expenses (restaurant_id, status);

-- updated_at triggers -----------------------------------------------------
CREATE TRIGGER trg_treasuries_updated_at
  BEFORE UPDATE ON public.treasuries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: SELECT to same-restaurant staff; NO write policies (RPC-only, and the
-- ledger is thus immutable to clients — rule 2) ---------------------------
ALTER TABLE public.financial_ref_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY treasuries_select_same_restaurant
  ON public.treasuries FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY payment_methods_select_same_restaurant
  ON public.payment_methods FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY shifts_select_same_restaurant
  ON public.shifts FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY treasury_movements_select_same_restaurant
  ON public.treasury_movements FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY treasury_transfers_select_same_restaurant
  ON public.treasury_transfers FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY treasury_adjustments_select_same_restaurant
  ON public.treasury_adjustments FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY expenses_select_same_restaurant
  ON public.expenses FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- Audit allowlist: add M4 financial actions -------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS chk_audit_log_m1_actions;
ALTER TABLE public.audit_log
  ADD CONSTRAINT chk_audit_log_m1_actions CHECK (
    action IN (
      'auth.login', 'auth.login_failed', 'auth.logout',
      'auth.password_reset_requested', 'auth.signup_completed',
      'staff.invited', 'staff.created', 'staff.updated', 'staff.deactivated',
      'staff.reactivated', 'staff.password_changed', 'staff.pin_set',
      'staff.pin_verify_failed', 'staff.owner_bootstrapped',
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
      'adjustment.created', 'adjustment.approved', 'adjustment.rejected', 'adjustment.executed', 'adjustment.reversed'
    )
  );

-- Seed: currency + default treasuries + payment-method mapping ------------
UPDATE public.restaurants
SET currency_code = 'EGP'
WHERE id = 'a0000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  v_rest uuid := 'a0000000-0000-4000-8000-000000000001';
  v_drawer uuid;
  v_safe uuid;
  v_instapay uuid;
  v_wallet uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treasuries WHERE restaurant_id = v_rest) THEN
    INSERT INTO public.treasuries (restaurant_id, name, type, is_shift_drawer, sort_order)
    VALUES (v_rest, 'درج الكاشير', 'cash', true, 0) RETURNING id INTO v_drawer;
    INSERT INTO public.treasuries (restaurant_id, name, type, is_shift_drawer, sort_order)
    VALUES (v_rest, 'الخزنة الرئيسية', 'cash', false, 10) RETURNING id INTO v_safe;
    INSERT INTO public.treasuries (restaurant_id, name, type, is_shift_drawer, sort_order)
    VALUES (v_rest, 'إنستا باي', 'digital', false, 20) RETURNING id INTO v_instapay;
    INSERT INTO public.treasuries (restaurant_id, name, type, is_shift_drawer, sort_order)
    VALUES (v_rest, 'المحافظ الإلكترونية', 'digital', false, 30) RETURNING id INTO v_wallet;

    INSERT INTO public.payment_methods (restaurant_id, name, code, treasury_id, sort_order)
    VALUES
      (v_rest, 'نقدي', 'cash', v_drawer, 0),
      (v_rest, 'إنستا باي', 'instapay', v_instapay, 10),
      (v_rest, 'محفظة إلكترونية', 'ewallet', v_wallet, 20);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
