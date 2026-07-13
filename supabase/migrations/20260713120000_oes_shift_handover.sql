-- OES Shift Handover (SHA) — Vision V-A18…V-A24 · Plan Approved 2026-07-13
-- Pending → Receive → Transfer under F1. No silent Main credit on close.

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
    'handover.created', 'handover.received', 'handover.rejected', 'handover.re_requested'
  )
);

DO $$ BEGIN
  CREATE TYPE public.shift_handover_kind AS ENUM ('to_main', 'to_next_shift');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.shift_handover_status AS ENUM ('pending', 'executed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.shift_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  reference text NOT NULL,
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  kind public.shift_handover_kind NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status public.shift_handover_status NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.staff(id),
  received_by uuid REFERENCES public.staff(id),
  rejected_by uuid REFERENCES public.staff(id),
  target_shift_id uuid REFERENCES public.shifts(id),
  transfer_id uuid REFERENCES public.treasury_transfers(id),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  rejected_at timestamptz,
  UNIQUE (restaurant_id, reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_handovers_one_pending
  ON public.shift_handovers (shift_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_shift_handovers_rest_status
  ON public.shift_handovers (restaurant_id, status, created_at DESC);

ALTER TABLE public.shift_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shift_handovers_select ON public.shift_handovers;
CREATE POLICY shift_handovers_select ON public.shift_handovers
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE OR REPLACE FUNCTION public.restaurant_has_pending_handover(p_rest uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_handovers
    WHERE restaurant_id = p_rest AND status = 'pending'
  );
$$;

CREATE OR REPLACE FUNCTION public.main_cash_treasury_id(p_rest uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.treasuries
  WHERE restaurant_id = p_rest AND type = 'cash' AND is_shift_drawer = false AND is_active = true
  ORDER BY sort_order LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.drawer_treasury_id(p_rest uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.treasuries
  WHERE restaurant_id = p_rest AND is_shift_drawer = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.assert_no_pending_handover(p_rest uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.restaurant_has_pending_handover(p_rest) THEN
    RAISE EXCEPTION 'HANDOVER_PENDING';
  END IF;
END;
$$;
