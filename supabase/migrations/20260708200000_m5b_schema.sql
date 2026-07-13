-- M5B: Order management schema — customers, lifecycle dimensions, collection F1,
-- order timeline, future extensibility hooks (ADR-0024, ADR-0025).

-- Enums -------------------------------------------------------------------
CREATE TYPE public.pos_order_type AS ENUM ('takeaway', 'delivery', 'dine_in');
CREATE TYPE public.order_payment_status AS ENUM ('unpaid', 'partial', 'paid');
CREATE TYPE public.order_fulfillment_status AS ENUM (
  'new', 'preparing', 'ready', 'delivered', 'cancelled'
);
CREATE TYPE public.order_print_status AS ENUM ('not_needed', 'pending', 'done', 'failed');
CREATE TYPE public.collection_status AS ENUM ('pending', 'approved', 'rejected', 'reversed');

-- Phone normalization (shared lookup) -------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
$$;

-- Customers (master data — extensible) ------------------------------------
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  notes text,
  loyalty_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  phone_raw text NOT NULL,
  phone_normalized text NOT NULL,
  label text NOT NULL DEFAULT 'primary',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customer_phones_normalized UNIQUE (restaurant_id, phone_normalized)
);

CREATE TABLE public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  label text NOT NULL DEFAULT 'home',
  address_line text NOT NULL,
  delivery_zone text,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_restaurant ON public.customers (restaurant_id, display_name);
CREATE INDEX idx_customer_phones_customer ON public.customer_phones (customer_id);
CREATE INDEX idx_customer_addresses_customer ON public.customer_addresses (customer_id);

-- Order timeline (first-class, UI-ready) ----------------------------------
CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  entity_type text,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_events_type CHECK (
    event_type IN (
      'order.created', 'collection.recorded', 'collection.approved', 'collection.rejected',
      'collection.reversed', 'order.amended', 'kitchen.sent', 'print.enqueued',
      'fulfillment.updated', 'order.delivered', 'order.cancelled'
    )
  )
);

CREATE INDEX idx_order_events_order_time ON public.order_events (order_id, created_at ASC);
CREATE INDEX idx_order_events_restaurant ON public.order_events (restaurant_id, created_at DESC);

-- Order amendments audit --------------------------------------------------
CREATE TABLE public.order_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  amendment_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_amendments_order ON public.order_amendments (order_id, created_at);

-- Orders: lifecycle + future hooks ----------------------------------------
ALTER TABLE public.orders
  ADD COLUMN customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  ADD COLUMN payment_status public.order_payment_status NOT NULL DEFAULT 'unpaid',
  ADD COLUMN fulfillment_status public.order_fulfillment_status NOT NULL DEFAULT 'new',
  ADD COLUMN print_status public.order_print_status NOT NULL DEFAULT 'pending',
  ADD COLUMN delivery_name text,
  ADD COLUMN delivery_phone text,
  ADD COLUMN delivery_address text,
  ADD COLUMN delivery_zone text,
  ADD COLUMN delivery_notes text,
  ADD COLUMN dine_in_table_ref text,
  ADD COLUMN promotions_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Migrate order_type text → enum
ALTER TABLE public.orders ADD COLUMN order_type_new public.pos_order_type;
UPDATE public.orders SET order_type_new = CASE
  WHEN order_type = 'delivery' THEN 'delivery'::public.pos_order_type
  WHEN order_type = 'dine_in' THEN 'dine_in'::public.pos_order_type
  ELSE 'takeaway'::public.pos_order_type
END;
ALTER TABLE public.orders DROP COLUMN order_type;
ALTER TABLE public.orders RENAME COLUMN order_type_new TO order_type;
ALTER TABLE public.orders ALTER COLUMN order_type SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN order_type SET DEFAULT 'takeaway';

CREATE INDEX idx_orders_payment_status ON public.orders (restaurant_id, payment_status, created_at DESC);
CREATE INDEX idx_orders_fulfillment_status ON public.orders (restaurant_id, fulfillment_status, created_at DESC);
CREATE INDEX idx_orders_customer ON public.orders (customer_id) WHERE customer_id IS NOT NULL;

-- order_payments: F1 collection lifecycle (ADR-0025) ----------------------
ALTER TABLE public.order_payments
  ADD COLUMN shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  ADD COLUMN collection_status public.collection_status NOT NULL DEFAULT 'pending',
  ADD COLUMN net_amount numeric(14, 2),
  ADD COLUMN created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN approved_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN rejected_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN reversed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN rejection_reason text,
  ADD COLUMN reversal_reason text,
  ADD COLUMN reverses_id uuid REFERENCES public.order_payments (id) ON DELETE SET NULL,
  ADD COLUMN auto_approved boolean NOT NULL DEFAULT false;

CREATE INDEX idx_order_payments_shift_status ON public.order_payments (shift_id, collection_status)
  WHERE collection_status = 'pending';
CREATE INDEX idx_order_payments_status ON public.order_payments (collection_status, created_at);

-- Backfill M5A data -------------------------------------------------------
UPDATE public.order_payments op
SET
  shift_id = o.shift_id,
  collection_status = 'approved',
  auto_approved = true,
  approved_at = op.created_at,
  net_amount = op.amount - op.change_given,
  created_by = o.created_by
FROM public.orders o
WHERE o.id = op.order_id;

UPDATE public.orders
SET
  payment_status = 'paid',
  fulfillment_status = 'delivered',
  print_status = 'done'
WHERE status = 'closed';

-- Backfill timeline from existing orders (minimal history)
INSERT INTO public.order_events (restaurant_id, order_id, event_type, actor_id, entity_type, entity_id, payload, created_at)
SELECT
  o.restaurant_id, o.id, 'order.created', o.created_by, 'order', o.id,
  jsonb_build_object('reference', o.reference, 'total', o.total, 'order_type', o.order_type::text),
  o.created_at
FROM public.orders o;

INSERT INTO public.order_events (restaurant_id, order_id, event_type, actor_id, entity_type, entity_id, payload, created_at)
SELECT
  o.restaurant_id, op.order_id, 'collection.approved', op.approved_by, 'order_payment', op.id,
  jsonb_build_object('reference', op.reference, 'amount', op.amount, 'net_amount', op.net_amount, 'auto_approved', true),
  coalesce(op.approved_at, op.created_at)
FROM public.order_payments op
JOIN public.orders o ON o.id = op.order_id
WHERE op.collection_status = 'approved';

INSERT INTO public.order_events (restaurant_id, order_id, event_type, actor_id, entity_type, entity_id, payload, created_at)
SELECT
  kt.restaurant_id, kt.order_id, 'kitchen.sent', o.created_by, 'kitchen_ticket', kt.id,
  jsonb_build_object('reference', kt.reference),
  kt.created_at
FROM public.kitchen_tickets kt
JOIN public.orders o ON o.id = kt.order_id;

-- RLS (SELECT only — writes via RPC) --------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY customer_phones_select ON public.customer_phones FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY customer_addresses_select ON public.customer_addresses FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY order_events_select ON public.order_events FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY order_amendments_select ON public.order_amendments FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- Widen audit_log allowlist for M5B order events ----------------------------
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
    'order.reprinted',
    'kitchen.ticket_created', 'print.job_enqueued',
    'customer.created', 'customer.updated'
  )
);

NOTIFY pgrst, 'reload schema';
