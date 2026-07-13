# ADR-0017: Single-restaurant scope — no multi-tenant

**Status:** Accepted
**Date:** 2026-07-07
**Supersedes:** the M2 "Organization" module in [ADR-0004](./0004-app-foundation-before-m2.md)'s roadmap.

## Context

NIHA POS is **not a SaaS** product. It runs the operation of **one restaurant (Niha Yam)**. Earlier
roadmap drafts carried a multi-tenant shape (an "Organization" module, multi-restaurant management,
chains/companies). That complexity does not serve the real goal and slows delivery.

Guiding principle from the product owner:

> **Build what we need today, but design it so it does not block future expansion — and do not add
> complexity that does not serve the real operation.**

## Decision

1. **One restaurant, one company.** No Organizations, chains, multi-restaurant, or multi-company
   concepts are built — now or in later phases. The **M2 "Organization" module is dropped.**

2. **Single branch today.** The system operates a single branch. Multi-branch is a _possible future
   additive change_, but **no module is architected on the assumption of many branches**: no branch
   pickers, no per-branch switching UI, no cross-branch flows.

3. **Keep the columns, drop the complexity.** The existing `restaurant_id` / `branch_id` columns and
   RLS helpers (`auth_restaurant_id()`, `has_branch_access()`, …) stay as-is. They are cheap, keep
   RLS correct, and preserve the future multi-branch option. Modules resolve _the_ restaurant and
   _the_ branch through these helpers — they never enumerate or select among many.

4. **No restaurant/branch admin module.** Restaurant profile + branch details become a small part of
   a future **Settings** surface, not a multi-entity CRUD admin.

## What this explicitly removes from the roadmap

- M2 "Organization" (`restaurants`/`branches` admin UI, multi-restaurant management).
- Any "switch restaurant / switch company" concept.
- Treating multi-branch as a first-class requirement in POS, treasury, menu, or reports.

## What stays unchanged

- All U1 foundations and the principles in ADR-0001..0016.
- The single `restaurants` + single `branches` rows created in M1 remain the operational context.
- Future expansion is still possible (add a branch row, add a picker) **without re-architecture**,
  because `branch_id` is already threaded through the schema and RLS.

## Consequences

- The roadmap is reordered around operating one restaurant fast (see [modules.md](../modules.md)).
- Reviewers reject any new module design that introduces org/chain/multi-restaurant abstractions or
  that hard-requires multiple branches.
