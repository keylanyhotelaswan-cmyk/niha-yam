# ADR-0012: Authorization & Permissions Foundation (F2)

**Status:** Accepted (principle) · Implementation deferred (Planning Only)
**Date:** 2026-07-07
**Track:** F2 — Authorization & Permissions Foundation (cross-cutting foundation track, not a feature
module).
**Applies to:** all modules that expose actions or data (UI + database), from the module where
fine-grained authorization is first required onward.

## Context

Today (U1/M1) authorization is **role-derived**: a small `Permission` union is computed from staff
roles (`owner`/`manager` vs others) — see [ADR-0007](./adr/0007-navigation-permissions-breadcrumbs.md)
and `src/features/auth/permissions.ts`. This is enough for the foundation, but the product owner
wants the system to eventually support a **flexible permission system, not roles only**, so future
modules are designed with that end-state in mind and do not hard-code role checks that are painful
to generalize later.

## Decision (principle only — nothing built now)

Adopt a **flexible authorization model** as the target architecture. When implemented, F2 will
provide:

- **Roles** — named bundles (owner, manager, cashier, waiter, kitchen, …).
- **Permissions** — granular capabilities (e.g. `staff.manage`, `pos.access`, `payments.reverse`).
- **Permission Groups** — logical grouping of permissions for easier assignment.
- **Role → Permissions** — a role maps to a set of permissions (data-driven, not code-driven).
- **User → Extra Permissions (Override)** — per-user grants/revocations layered on top of role
  permissions, so an individual can be extended or restricted without inventing a new role.
- **UI protection** — navigation and controls hidden/disabled by permission (extends the current
  `usePermissions().can()` pattern).
- **Database protection (RLS)** — Row-Level Security policies enforce the same permissions server-side;
  the client check is convenience, the DB check is authority (thin client / thick DB).
- **Audit of permission changes** — every change to roles, permissions, groups, or user overrides is
  written to `audit_log` (who, what, before/after, when).

### Design guidance for upcoming modules (so F2 fits later without rework)

1. Keep authorization checks **capability-based** (`can('payments.reverse')`), not role-based
   (`if (role === 'manager')`), reusing the existing `Permission` union which F2 will later back with
   data instead of a static map.
2. Treat the current role→permission map in `permissions.ts` as the **single seam** that F2 replaces
   with a data-driven source; consumers (`can()`) should not change.
3. Every new sensitive action should name a **permission** from day one, even while it is still
   role-derived.
4. RLS policies should be written so they can key off permissions/claims, not hard-coded roles, when
   F2 lands.

## Consequences

- No tables, RPCs, or UI now. `permissions.ts` and role-derived checks remain the implementation
  until F2 is scheduled.
- Modules M2+ must express access needs as **named permissions** to avoid a later refactor.
- When F2 is implemented it should be **backward compatible** with the current `can()` API
  (consistent with ADR-0008 API stability).

## Open items (resolve at F2 gate)

- Storage model: `roles`, `permissions`, `role_permissions`, `user_permissions` (override), optional
  `permission_groups`.
- How permissions surface in the JWT / RLS (claims vs lookup).
- Migration from the static role→permission map to the data-driven model without breaking `can()`.
- Interaction with branch scoping (permission per branch vs global).
