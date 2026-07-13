# ADR-0016: Feature isolation — session, authorization & identity types live in `shared`

**Status:** Accepted
**Date:** 2026-07-07
**Track:** U1 — App Foundation (Step 8, architecture review).

## Context

The Step 8 architecture review found the `staff` feature importing directly from the `auth` feature:
`useAuth` (session), `usePermissions` (authorization), and shared domain types re-exported from
`auth/types`. That violates the rule that **no feature depends on another feature** (ADR-0014) and
would make every future module depend on `auth`.

The underlying cause: session, authorization, and shared identity types are **cross-cutting
foundations**, but they were physically located inside a sibling feature (`features/auth`).

## Decision

Move the cross-cutting pieces out of `features/auth` into the shared foundation. `features/auth`
keeps only the **auth UI feature** (login/signup/forgot pages, their forms, schemas, and
invite-preview API).

```
src/shared/
  session/
    session.api.ts       # fetchStaffProfile, logAuthEvent (identity/session data access)
    SessionProvider.tsx  # provider + useSession() (was AuthProvider/useAuth)
  access/
    permissions.ts       # Permission, computePermissions, usePermissions (was features/auth/permissions)
  types/
    identity.ts          # StaffRole, StaffBranchAssignment, StaffProfile (shared identity types)
```

- **`useSession()`** replaces `useAuth()` — session/identity is a foundation, not a feature.
- **`usePermissions()` / `Permission`** now live in `shared/access` (capability-based, F2-ready per
  ADR-0012 — F2 swaps the source behind the same `can()` API).
- **Shared identity types** live in `shared/types/identity.ts`. Feature-owned types stay in the
  feature: `InvitePreview` in `auth`; `StaffListItem`, `StaffInviteResult` in `staff` (which imports
  `StaffBranchAssignment` from shared).

### Dependency rule (enforced by review)

```
app → features → shared → lib
```

Features may import from `shared` and `lib`, never from another feature. `shared` never imports a
feature.

## Consequences

- `staff` (and every future module) depends on `shared/session` + `shared/access`, not on `auth`.
- No feature→feature imports remain.
- Authorization is centralized in `shared/access`, ready for the F2 data-driven model with no
  consumer changes.
- One-time churn: rename `useAuth`→`useSession` and update imports; behavior unchanged.
