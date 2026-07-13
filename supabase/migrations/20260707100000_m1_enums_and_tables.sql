-- M1: enums and core tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.staff_role AS ENUM (
  'owner',
  'manager',
  'cashier',
  'waiter',
  'kitchen'
);

CREATE TABLE public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  currency_code char(3) NOT NULL DEFAULT 'SAR',
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_branches_restaurant_code UNIQUE (restaurant_id, code)
);

CREATE INDEX idx_branches_restaurant ON public.branches (restaurant_id);

CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  pin_hash text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_restaurant ON public.staff (restaurant_id);

CREATE TABLE public.staff_branches (
  staff_id uuid NOT NULL REFERENCES public.staff (id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches (id) ON DELETE CASCADE,
  role public.staff_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, branch_id)
);

CREATE INDEX idx_staff_branches_branch ON public.staff_branches (branch_id);
CREATE INDEX idx_staff_branches_role ON public.staff_branches (branch_id, role);

CREATE TABLE public.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  email text NOT NULL,
  display_name text NOT NULL,
  branch_assignments jsonb NOT NULL,
  token text NOT NULL UNIQUE,
  invited_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_staff_invites_assignments_array CHECK (jsonb_typeof(branch_assignments) = 'array')
);

CREATE UNIQUE INDEX uq_staff_invites_pending_email
  ON public.staff_invites (restaurant_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_log_m1_actions CHECK (
    action IN (
      'auth.login',
      'auth.login_failed',
      'auth.logout',
      'auth.password_reset_requested',
      'auth.signup_completed',
      'staff.invited',
      'staff.created',
      'staff.updated',
      'staff.deactivated',
      'staff.pin_set',
      'staff.pin_verify_failed',
      'staff.owner_bootstrapped'
    )
  ),
  CONSTRAINT chk_audit_log_restaurant CHECK (
    restaurant_id IS NOT NULL OR action = 'auth.login_failed'
  )
);

CREATE INDEX idx_audit_log_restaurant_time ON public.audit_log (restaurant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_restaurants_updated_at
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON public.staff
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
