# ADR-0018: Direct staff creation — username + password/PIN, no invite links

**Status:** Accepted · Auth mechanism locked (see below) · Implemented in M2 (see ADR-0019)
**Date:** 2026-07-07
**Revises:** M1 staff onboarding (invite links + email signup).

## Context

M1 onboarded staff via **invite links + email signup** (`staff_invites`, `create_staff_invite`,
`get_invite_by_token`, a token signup page, `InvitePreview`). For a single restaurant this is the
wrong shape: it depends on email, requires the employee to open a link and self-register, and adds a
token lifecycle nobody needs. In practice the manager sits at the restaurant and should create the
account directly.

## Decision

Replace the invite flow with **direct staff creation by a manager**.

### Creation (manager, in-app)

The manager creates a staff member by entering:

- **Display name**
- **Username** (unique login identifier)
- **Initial password** and/or **PIN** (which one depends on the role)
- **Role**
- **Status** (active/inactive)

The account is **created immediately** — no link, no email step, no self-registration.

### Login

- **Manager / admin:** username + password.
- **Cashier fast path:** PIN (unchanged from M1 — `pin_hash`, `set_staff_pin`, `verify_staff_pin`).
- **Email is optional** — captured only if useful later (e.g. password reset/notifications). It is
  **not** part of login.

### Deprecations (removed/replaced in the Staff-rework module — not deleted now)

- `staff_invites` table, `create_staff_invite`, `get_invite_by_token`.
- Token signup page/form and `InvitePreview` type in `features/auth`.
- Audit: `staff.invited` and `auth.signup_completed` give way to `staff.created` (direct).

## Auth mechanism (LOCKED)

Username/password is the login model; **email-based auth is not exposed to users**.

- **Synthesized internal email.** Each staff account maps its username to an internal address on
  `auth.users`, e.g. `<username>@staff.niha.local`. Supabase Auth continues to work unchanged
  underneath; the **UI shows only the username**. Login translates `username` → internal email, then
  calls `signInWithPassword`.
- **Server-side creation with the service role.** Accounts are created by an edge function / admin
  RPC using the service role (same trust level as `bootstrap:owner`). **Client code never holds the
  service role** (M1 security stance preserved).
- **Uniqueness.** `username` is unique per restaurant; the internal email is derived from it and is
  therefore unique too.
- **PIN vs password by role.** Managers/admins use username + password; cashiers use PIN (existing
  `pin_hash` / `verify_staff_pin`). A role may have both.
- **Email is optional metadata** — a nullable real email may be stored later for password reset /
  notifications, but is never required for login.

### Still to detail at the M2 planning gate

- Password reset without a real email (manager-initiated reset flow).
- Exact `username` normalization/validation rules and the internal-email domain constant.

## Consequences

- Onboarding is faster and works offline of email entirely.
- The Staff feature (reference implementation, ADR-0014) gains a create dialog and username/password
  login; the invite surface is retired.
- Authorization stays capability-based (`can(...)`), ready for F2 (ADR-0012).
