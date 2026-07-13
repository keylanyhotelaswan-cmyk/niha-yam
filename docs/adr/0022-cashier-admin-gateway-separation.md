# ADR-0022: Separate cashier and admin gateways (future direction)

**Status:** Proposed — **deferred** (documented during M5 planning; not implemented in M5)
**Date:** 2026-07-08
**Complements:** [ADR-0017](./0017-single-restaurant-scope.md), [ADR-0018](./0018-direct-staff-creation.md),
[ADR-0021](./0021-pos-thin-client-financial-core.md), F2 (authorization foundation).

## Context

During M5 planning the product owner noted a future desire for **fully separated environments**:

- A **cashier gateway** — POS-only, optimized for speed at the counter.
- An **admin gateway** — management, menu, treasury, staff, reports — optimized for oversight.

Today both surfaces live in one SPA (`/pos` vs `/admin`) with shared auth and permissions. This works
for M5 delivery but is not the long-term UX target.

## Decision (direction only — not scheduled)

When scheduled (post core operations loop), evolve toward:

1. **Two entry points / deployments** (or two clearly isolated app shells) — cashier sees POS only;
   admin sees admin only. No cross-navigation clutter on either side.
2. **Same backend** — one Supabase project, same RPCs, same ledger, same permission model.
3. **Same authorization source** — F2 permissions (or today's role-derived `permissions.ts`) gates
   which gateway a staff member may use. A cashier role lands on POS; manager/owner may access admin
   (and optionally POS).
4. **No duplicate money logic** — ADR-0021 remains: even a standalone POS app is a thin client.

## Why deferred

Implementing full gateway separation in M5 would delay the operational POS without changing the
financial architecture. M5 ships the POS screen inside the current app; this ADR records intent so
the split can happen without redesigning orders, treasury, or auth.

## Consequences

- M5 POS is built as a **feature module** (`features/pos/`) with minimal coupling to admin shell
  (reuse shared session, i18n, design tokens — ADR-0016).
- Future split is mostly routing/deployment/UX — not a database or RPC rewrite.
- F2 should model permissions like `pos.access` vs `admin.access` (or gateway-scoped groups) when
  the split is implemented.
