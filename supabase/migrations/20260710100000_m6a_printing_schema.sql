-- M6A: Printing schema — registry, profiles, templates, job lifecycle, bridges
-- Part A Approved 2026-07-10. No Bridge hardware / no UI in this slice.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.printer_role AS ENUM (
  'cashier', 'kitchen', 'bar', 'dessert', 'label', 'receipt', 'other'
);

CREATE TYPE public.printer_connection AS ENUM (
  'windows_spooler', 'lan_9100', 'usb', 'bluetooth', 'web_print', 'other'
);

-- Extend job kinds (A7)
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'test_page';
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'label';
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'barcode';
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'kitchen_sticker';
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'delivery_label';

-- Extend job status lifecycle
ALTER TYPE public.print_job_status ADD VALUE IF NOT EXISTS 'claimed';
ALTER TYPE public.print_job_status ADD VALUE IF NOT EXISTS 'printing';
ALTER TYPE public.print_job_status ADD VALUE IF NOT EXISTS 'retry_wait';
ALTER TYPE public.print_job_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ---------------------------------------------------------------------------
-- printers (registry + profile A1)
-- ---------------------------------------------------------------------------
CREATE TABLE public.printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  role public.printer_role NOT NULL,
  device_type text NOT NULL DEFAULT 'thermal',
  connection public.printer_connection NOT NULL DEFAULT 'windows_spooler',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  paper_width_mm int NOT NULL DEFAULT 80,
  encoding text NOT NULL DEFAULT 'CP864',
  default_copies int NOT NULL DEFAULT 1,
  auto_cut boolean NOT NULL DEFAULT true,
  open_cash_drawer boolean NOT NULL DEFAULT false,
  logo_url text,
  footer_text text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  last_error text,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_printers_name CHECK (length(trim(name)) > 0),
  CONSTRAINT chk_printers_copies CHECK (default_copies >= 1 AND default_copies <= 5),
  CONSTRAINT chk_printers_width CHECK (paper_width_mm IN (58, 80))
);

CREATE INDEX idx_printers_restaurant ON public.printers (restaurant_id, role, is_active);

-- ---------------------------------------------------------------------------
-- print_bridges (A6)
-- ---------------------------------------------------------------------------
CREATE TABLE public.print_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  display_name text NOT NULL DEFAULT 'Bridge',
  device_name text,
  windows_username text,
  version text,
  pairing_token_hash text,
  last_heartbeat_at timestamptz,
  last_connected_at timestamptz,
  last_restart_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_print_bridges_restaurant ON public.print_bridges (restaurant_id, is_active);

-- ---------------------------------------------------------------------------
-- print_templates (seed only — no editor)
-- ---------------------------------------------------------------------------
CREATE TABLE public.print_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  kind public.print_job_kind NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_print_templates_kind_version UNIQUE (restaurant_id, kind, version),
  CONSTRAINT chk_print_templates_name CHECK (length(trim(name)) > 0)
);

CREATE TABLE public.print_role_defaults (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  role public.printer_role NOT NULL,
  printer_id uuid REFERENCES public.printers (id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.print_templates (id) ON DELETE SET NULL,
  PRIMARY KEY (restaurant_id, role)
);

-- ---------------------------------------------------------------------------
-- Extend print_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.print_jobs
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS printer_id uuid REFERENCES public.printers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.print_templates (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version int,
  ADD COLUMN IF NOT EXISTS bridge_id uuid REFERENCES public.print_bridges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_reprint boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reprint_reason text,
  ADD COLUMN IF NOT EXISTS reprint_of_job_id uuid REFERENCES public.print_jobs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES public.print_bridges (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_print_jobs_queue
  ON public.print_jobs (restaurant_id, status, next_attempt_at, created_at);

-- ---------------------------------------------------------------------------
-- print_attempts (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.print_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  print_job_id uuid NOT NULL REFERENCES public.print_jobs (id) ON DELETE RESTRICT,
  bridge_id uuid REFERENCES public.print_bridges (id) ON DELETE SET NULL,
  attempt_no int NOT NULL DEFAULT 1,
  status text NOT NULL,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT chk_print_attempts_status CHECK (
    status IN ('started', 'success', 'failure')
  )
);

CREATE INDEX idx_print_attempts_job ON public.print_attempts (print_job_id, started_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_bridges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_role_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY printers_select ON public.printers FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY print_bridges_select ON public.print_bridges FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY print_templates_select ON public.print_templates FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY print_role_defaults_select ON public.print_role_defaults FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());
CREATE POLICY print_attempts_select ON public.print_attempts FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

-- ---------------------------------------------------------------------------
-- Seed templates + placeholder printers for seed restaurant
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rest uuid := 'a0000000-0000-4000-8000-000000000001';
  v_tpl_receipt uuid;
  v_tpl_kitchen uuid;
  v_pr_cashier uuid;
  v_pr_kitchen uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = v_rest) THEN
    RETURN;
  END IF;

  INSERT INTO public.print_templates (restaurant_id, kind, name, version, body, is_active)
  VALUES (
    v_rest, 'receipt', 'Receipt v1', 1,
    jsonb_build_object(
      'blocks', jsonb_build_array(
        jsonb_build_object('type', 'text', 'key', 'restaurant_name', 'align', 'center', 'bold', true),
        jsonb_build_object('type', 'text', 'key', 'restaurant_phone', 'align', 'center'),
        jsonb_build_object('type', 'line'),
        jsonb_build_object('type', 'text', 'key', 'order_reference', 'bold', true),
        jsonb_build_object('type', 'text', 'key', 'datetime'),
        jsonb_build_object('type', 'text', 'key', 'order_type'),
        jsonb_build_object('type', 'text', 'key', 'customer'),
        jsonb_build_object('type', 'line'),
        jsonb_build_object('type', 'table', 'key', 'lines_priced'),
        jsonb_build_object('type', 'line'),
        jsonb_build_object('type', 'text', 'key', 'subtotal'),
        jsonb_build_object('type', 'text', 'key', 'discount'),
        jsonb_build_object('type', 'text', 'key', 'total', 'bold', true),
        jsonb_build_object('type', 'text', 'key', 'payments'),
        jsonb_build_object('type', 'text', 'key', 'change'),
        jsonb_build_object('type', 'line'),
        jsonb_build_object('type', 'text', 'key', 'footer', 'align', 'center'),
        jsonb_build_object('type', 'cut')
      )
    ),
    true
  )
  ON CONFLICT (restaurant_id, kind, version) DO NOTHING
  RETURNING id INTO v_tpl_receipt;

  INSERT INTO public.print_templates (restaurant_id, kind, name, version, body, is_active)
  VALUES (
    v_rest, 'kitchen', 'Kitchen Ticket v1', 1,
    jsonb_build_object(
      'blocks', jsonb_build_array(
        jsonb_build_object('type', 'text', 'key', 'order_reference', 'align', 'center', 'bold', true, 'size', 'large'),
        jsonb_build_object('type', 'text', 'key', 'order_type', 'bold', true),
        jsonb_build_object('type', 'text', 'key', 'datetime'),
        jsonb_build_object('type', 'text', 'key', 'cashier'),
        jsonb_build_object('type', 'line'),
        jsonb_build_object('type', 'table', 'key', 'lines_kitchen'),
        jsonb_build_object('type', 'text', 'key', 'order_note'),
        jsonb_build_object('type', 'cut')
      ),
      'forbid_prices', true
    ),
    true
  )
  ON CONFLICT (restaurant_id, kind, version) DO NOTHING
  RETURNING id INTO v_tpl_kitchen;

  SELECT id INTO v_tpl_receipt FROM public.print_templates
  WHERE restaurant_id = v_rest AND kind = 'receipt' AND version = 1;
  SELECT id INTO v_tpl_kitchen FROM public.print_templates
  WHERE restaurant_id = v_rest AND kind = 'kitchen' AND version = 1;

  IF NOT EXISTS (SELECT 1 FROM public.printers WHERE restaurant_id = v_rest AND role = 'cashier') THEN
    INSERT INTO public.printers (
      restaurant_id, name, role, device_type, connection, paper_width_mm, encoding,
      default_copies, auto_cut, open_cash_drawer, footer_text, is_active, sort_order
    ) VALUES (
      v_rest, 'طابعة الكاشير', 'cashier', 'thermal', 'windows_spooler', 80, 'CP864',
      1, true, true, 'شكرًا لزيارتكم', true, 0
    ) RETURNING id INTO v_pr_cashier;
  ELSE
    SELECT id INTO v_pr_cashier FROM public.printers
    WHERE restaurant_id = v_rest AND role = 'cashier' ORDER BY sort_order LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.printers WHERE restaurant_id = v_rest AND role = 'kitchen') THEN
    INSERT INTO public.printers (
      restaurant_id, name, role, device_type, connection, paper_width_mm, encoding,
      default_copies, auto_cut, open_cash_drawer, is_active, sort_order
    ) VALUES (
      v_rest, 'طابعة المطبخ', 'kitchen', 'thermal', 'windows_spooler', 80, 'CP864',
      1, true, false, true, 10
    ) RETURNING id INTO v_pr_kitchen;
  ELSE
    SELECT id INTO v_pr_kitchen FROM public.printers
    WHERE restaurant_id = v_rest AND role = 'kitchen' ORDER BY sort_order LIMIT 1;
  END IF;

  INSERT INTO public.print_role_defaults (restaurant_id, role, printer_id, template_id)
  VALUES
    (v_rest, 'cashier', v_pr_cashier, v_tpl_receipt),
    (v_rest, 'receipt', v_pr_cashier, v_tpl_receipt),
    (v_rest, 'kitchen', v_pr_kitchen, v_tpl_kitchen)
  ON CONFLICT (restaurant_id, role) DO UPDATE
    SET printer_id = excluded.printer_id,
        template_id = excluded.template_id;
END $$;

-- ---------------------------------------------------------------------------
-- Audit allowlist: printing actions
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
    'delivery_driver.created', 'delivery_driver.updated'
  )
);

NOTIFY pgrst, 'reload schema';
