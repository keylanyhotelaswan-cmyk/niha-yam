-- M2: Staff direct-creation schema changes.
-- 1) staff.username (login identity) + optional email metadata
-- 2) widen audit_log allowlist for new staff events
-- 3) retire the invite flow (trigger + invite RPCs) per ADR-0018
-- Append-only: earlier M1 migrations already applied.

-- 1) Username + optional email -----------------------------------------------
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS email text;

-- Username format (defense-in-depth; NULL allowed until re-bootstrap populates it).
ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS chk_staff_username_format;
ALTER TABLE public.staff
  ADD CONSTRAINT chk_staff_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$');

-- Unique per restaurant, case-insensitive. Partial so NULLs never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_username
  ON public.staff (restaurant_id, lower(username))
  WHERE username IS NOT NULL;

-- 2) Widen audit_log allowlist ------------------------------------------------
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS chk_audit_log_m1_actions;
ALTER TABLE public.audit_log
  ADD CONSTRAINT chk_audit_log_m1_actions CHECK (
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
      'staff.reactivated',
      'staff.password_changed',
      'staff.pin_set',
      'staff.pin_verify_failed',
      'staff.owner_bootstrapped'
    )
  );

-- 3) Retire the invite flow (ADR-0018) ---------------------------------------
-- Direct creation replaces invite links; the auth.users insert trigger and the
-- invite RPCs are removed. staff_invites table is kept for historical rows.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.create_staff_invite(text, text, jsonb);
DROP FUNCTION IF EXISTS public.get_invite_by_token(text);
