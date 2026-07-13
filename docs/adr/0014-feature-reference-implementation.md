# ADR-0014: Feature structure — Staff as the reference implementation

**Status:** Accepted
**Date:** 2026-07-07
**Track:** U1 — App Foundation (Step 7).

## Context

Step 7 retrofits the M1 Staff and Auth screens onto the U1 shell, tokens, Core UI, and patterns.
Because Staff is the **first real feature** built on the new system, the product owner designated it
the **reference implementation**: every future module copies its structure, naming, and separation of
concerns. It must also be written **forward-compatible** with the documented-but-unbuilt F1
(multi-treasury) and F2 (flexible permissions) foundations, so we do not re-architect later.

## Decision

### Canonical feature folder layout

```
src/features/<feature>/
  api/            # services: thin Supabase/RPC data access only (no UI, no state)
    <feature>.api.ts
  hooks/          # React Query wrappers (queries + mutations) + query-key factory
    <feature>.keys.ts
    use<Thing>.ts
  schemas/        # zod schemas for this feature's forms
    <feature>.schemas.ts
  components/      # feature-specific presentational components
    <Thing>.tsx
    dialogs/       # feature dialogs grouped together
      <Thing>Dialog.tsx
  pages/          # route-level composition only (no data access inline)
    <Thing>Page.tsx
  types.ts        # feature types (re-export shared domain types where relevant)
```

### Rules (the template every module follows)

1. **Layering:** `pages` compose `components` + `hooks`; `hooks` call `api` (services); `api` is the
   only place that talks to Supabase/RPC. UI never calls `supabase` directly.
2. **Query keys** live in a `*.keys.ts` factory; hooks and invalidations reference them (no ad-hoc
   string arrays scattered around).
3. **Mutations** invalidate via the key factory; **no blind refetch** (ADR-0010).
4. **Dialogs** are feature components under `components/dialogs/`, built on the shared `Dialog` /
   `ConfirmDialog`. They receive data + handlers via props (feature owns logic; patterns stay
   stateless per ADR-0008).
5. **Naming:** `use<Thing>` for hooks, `<Thing>Dialog` for dialogs, `<Thing>Page` for routes,
   `<feature>.api.ts` / `<feature>.schemas.ts` / `<feature>.keys.ts` for infra files.
6. **Authorization is capability-based** (`usePermissions().can('staff.manage')`) — not role checks —
   so F2 (ADR-0012) can swap the permission source without touching consumers. Action controls are
   hidden when the capability is absent (defense-in-depth with route guards).
7. **Financial forward-compat (F1/ADR-0013):** any future money movement is modeled as
   ledger/approval flows, never direct balance edits, and never uses `ConfirmDialog` for financial
   confirmation. (Not exercised by Staff, but the rule is stated so modules inherit it.)

### Retrofit constraint (Step 7 specifically)

No business logic, API, RPC, or database changes. Same requests, same results. Presentation and code
organization only. The one allowed performance-positive change: fetch reference data (branches) only
when actually needed (dialog open), which **reduces** requests and never increases them.

## Consequences

- New modules (M2+) scaffold from this exact layout, reducing review overhead and drift.
- Capability-based checks mean F2 is a source swap, not a refactor.
- Clear layering keeps data access measurable and cache invalidation centralized (ADR-0010).
