# ADR-0019: Privileged server-side operations via Supabase Edge Functions

**Status:** Accepted
**Date:** 2026-07-07
**Track:** M2 (Staff — Direct Creation). Realizes the server-side path anticipated by
[ADR-0018](./0018-direct-staff-creation.md).

## Context

Direct staff creation ([ADR-0018](./0018-direct-staff-creation.md)) must create and modify
`auth.users` (create user, set/reset password). Those operations require the **Supabase service
role**, which — per the M1 security stance — must **never** reach the browser or any `VITE_` variable.

Two rejected alternatives:

- **Client-side `signUp`** — creates the user but signs the browser in _as the new user_, replacing
  the manager's session, and may require email confirmation. Wrong for an admin creating accounts.
- **A SECURITY DEFINER RPC that writes `auth.users` directly** — bypasses GoTrue password hashing,
  the `identities` table, and email/confirmation handling; brittle and unsupported.

## Decision

Introduce **Supabase Edge Functions** as the project's server-side trust boundary for privileged
operations. The service role lives **only** in the Edge Function environment (secrets), never in the
client.

```
supabase/functions/
  _shared/            # auth-guard + cors + clients (service-role + caller-scoped)
  staff-create/       # create auth user (admin) + provision staff via RPC
  staff-reset-password/  # admin.updateUserById({ password })
```

### Rules

1. **Caller is authenticated and authorized.** Every function receives the caller's JWT (via
   `Authorization` header from `supabase.functions.invoke`). It creates a caller-scoped client and
   verifies the caller is an owner/manager (`is_owner_or_manager()` RPC) **before** using the service
   role. Unauthorized → 403.
2. **Service role is used only after the authorization check**, and only for the specific admin call.
3. **Business/data writes stay in SQL.** The function does the GoTrue admin call, then delegates data
   changes to a SECURITY DEFINER RPC (e.g. `provision_staff`) so the database remains the single
   source of truth and audit is written server-side (ADR-0015 applies to those RPCs).
4. **Thin functions.** No business rules beyond the admin call + RPC delegation + error mapping.
5. **Secrets.** `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are function secrets; never `VITE_`.

## Consequences

- The client never holds the service role; privileged actions are auditable, authorized chokepoints.
- Local dev/deploy gains an Edge Functions step (`supabase functions serve` / `deploy`) — documented
  in the README when M2 is implemented.
- Future privileged needs (e.g. F2 admin ops) reuse the same `_shared` guard pattern.
