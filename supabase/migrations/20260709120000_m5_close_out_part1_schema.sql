-- M5 Close-Out Part 1: delivery_drivers, order FK, timeline events

CREATE TABLE IF NOT EXISTS public.delivery_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_drivers_restaurant
  ON public.delivery_drivers (restaurant_id, is_active, display_name);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_driver_id uuid
    REFERENCES public.delivery_drivers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_delivery_driver
  ON public.orders (delivery_driver_id)
  WHERE delivery_driver_id IS NOT NULL;

ALTER TABLE public.delivery_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_drivers_select ON public.delivery_drivers;
CREATE POLICY delivery_drivers_select ON public.delivery_drivers
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

DROP POLICY IF EXISTS delivery_drivers_manager_write ON public.delivery_drivers;
CREATE POLICY delivery_drivers_manager_write ON public.delivery_drivers
  FOR ALL TO authenticated
  USING (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager())
  WITH CHECK (restaurant_id = public.auth_restaurant_id() AND public.is_owner_or_manager());

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
    'fulfillment.updated', 'order.delivered', 'order.cancelled',
    'delivery.driver_assigned', 'delivery.driver_changed'
  )
);
