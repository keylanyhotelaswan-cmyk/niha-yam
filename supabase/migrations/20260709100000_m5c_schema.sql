-- M5C: Customer payment axis, requires_review, human timeline events,
-- notification settings port (ADR-0025 §1.1–§2.1, ADR-0026).

-- Orders: review flag + last review metadata --------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.staff (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_requires_review
  ON public.orders (restaurant_id, requires_review)
  WHERE requires_review = true;

-- Expand order_events allowlist ---------------------------------------------
ALTER TABLE public.order_events DROP CONSTRAINT IF EXISTS chk_order_events_type;
ALTER TABLE public.order_events ADD CONSTRAINT chk_order_events_type CHECK (
  event_type IN (
    'order.created',
    'collection.recorded', 'collection.approved', 'collection.rejected', 'collection.reversed',
    'order.amended',
    'order.item_added', 'order.item_removed', 'order.qty_changed', 'order.modifiers_changed',
    'order.customer_changed', 'order.tender_changed', 'order.total_changed',
    'order.review_flagged', 'order.review_cleared',
    'kitchen.sent', 'print.enqueued',
    'fulfillment.updated', 'order.delivered', 'order.cancelled'
  )
);

-- Restaurant notification settings (provider-agnostic port) -----------------
CREATE TABLE IF NOT EXISTS public.restaurant_notification_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE CASCADE,
  notify_on_order_edit boolean NOT NULL DEFAULT false,
  providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- providers example: [{"type":"telegram","enabled":false,"config":{}},{"type":"whatsapp","enabled":false,"config":{}}]
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_notification_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_notification_settings_select ON public.restaurant_notification_settings;
CREATE POLICY restaurant_notification_settings_select
  ON public.restaurant_notification_settings FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- Outbox for optional external notify (adapters consume later) --------------
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE CASCADE,
  channel text NOT NULL,
  event_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON public.notification_outbox (restaurant_id, status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_outbox_select ON public.notification_outbox;
CREATE POLICY notification_outbox_select
  ON public.notification_outbox FOR SELECT TO authenticated
  USING (
    restaurant_id = public.auth_restaurant_id()
    AND public.is_owner_or_manager()
  );

-- Widen audit allowlist -----------------------------------------------------
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
    'kitchen.ticket_created', 'print.job_enqueued',
    'customer.created', 'customer.updated'
  )
);

NOTIFY pgrst, 'reload schema';
