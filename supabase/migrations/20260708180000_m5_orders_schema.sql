-- M5: Orders schema (takeaway POS). Cart is client-only; all writes via RPC.
-- Immutable after finalize (F1). Offline-ready: nullable client_request_id for future sync.

CREATE TYPE public.order_status AS ENUM ('closed', 'voided', 'refunded');
CREATE TYPE public.discount_type AS ENUM ('amount', 'percent');
CREATE TYPE public.kitchen_line_status AS ENUM ('new', 'preparing', 'ready', 'served', 'cancelled');
CREATE TYPE public.print_job_kind AS ENUM ('receipt', 'kitchen');
CREATE TYPE public.print_job_status AS ENUM ('pending', 'completed', 'failed');

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  shift_id uuid NOT NULL REFERENCES public.shifts (id) ON DELETE RESTRICT,
  status public.order_status NOT NULL DEFAULT 'closed',
  order_type text NOT NULL DEFAULT 'takeaway',
  subtotal numeric(14, 2) NOT NULL,
  discount_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL,
  discount_type public.discount_type,
  discount_value numeric(14, 2),
  discount_reason text,
  order_note text,
  client_request_id uuid,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_orders_reference UNIQUE (restaurant_id, reference),
  CONSTRAINT uq_orders_client_request UNIQUE (restaurant_id, client_request_id)
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  menu_item_id uuid REFERENCES public.menu_items (id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  unit_price numeric(14, 2) NOT NULL,
  quantity int NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  is_open_price boolean NOT NULL DEFAULT false,
  needs_kitchen boolean NOT NULL DEFAULT false,
  needs_print boolean NOT NULL DEFAULT false,
  line_note text,
  sort_order int NOT NULL DEFAULT 0,
  CONSTRAINT chk_order_items_qty CHECK (quantity >= 1)
);

CREATE TABLE public.order_item_modifiers (
  order_item_id uuid NOT NULL REFERENCES public.order_items (id) ON DELETE RESTRICT,
  modifier_option_id uuid REFERENCES public.modifier_options (id) ON DELETE SET NULL,
  group_name text NOT NULL,
  option_name text NOT NULL,
  price_delta numeric(14, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (order_item_id, option_name, group_name)
);

CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods (id) ON DELETE RESTRICT,
  treasury_id uuid NOT NULL REFERENCES public.treasuries (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  change_given numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_order_payments_reference UNIQUE (order_id, reference)
);

CREATE TABLE public.kitchen_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  shift_id uuid REFERENCES public.shifts (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_kitchen_tickets_reference UNIQUE (restaurant_id, reference)
);

CREATE TABLE public.kitchen_ticket_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.kitchen_tickets (id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items (id) ON DELETE RESTRICT,
  name text NOT NULL,
  quantity int NOT NULL,
  line_note text,
  modifier_summary text,
  status public.kitchen_line_status NOT NULL DEFAULT 'new',
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  reference text NOT NULL,
  kind public.print_job_kind NOT NULL,
  status public.print_job_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_jobs_reference UNIQUE (restaurant_id, reference)
);

CREATE INDEX idx_orders_restaurant_created ON public.orders (restaurant_id, created_at DESC);
CREATE INDEX idx_orders_shift ON public.orders (shift_id, created_at);
CREATE INDEX idx_order_items_order ON public.order_items (order_id);
CREATE INDEX idx_order_payments_order ON public.order_payments (order_id);
CREATE INDEX idx_kitchen_tickets_status ON public.kitchen_tickets (restaurant_id, status, created_at);
CREATE INDEX idx_print_jobs_status ON public.print_jobs (restaurant_id, status, created_at);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_ticket_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_same_restaurant ON public.orders FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.restaurant_id = public.auth_restaurant_id()));
CREATE POLICY order_item_modifiers_select ON public.order_item_modifiers FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = order_item_id AND o.restaurant_id = public.auth_restaurant_id()
  ));
CREATE POLICY order_payments_select ON public.order_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.restaurant_id = public.auth_restaurant_id()));
CREATE POLICY kitchen_tickets_select ON public.kitchen_tickets FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY kitchen_ticket_lines_select ON public.kitchen_ticket_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.kitchen_tickets kt WHERE kt.id = ticket_id AND kt.restaurant_id = public.auth_restaurant_id()
  ));
CREATE POLICY print_jobs_select ON public.print_jobs FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

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
    'order.finalized', 'kitchen.ticket_created', 'print.job_enqueued'
  )
);

NOTIFY pgrst, 'reload schema';
