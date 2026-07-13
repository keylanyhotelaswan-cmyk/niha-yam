# ADR-0008: Component library principles & Definition of Done

**Status:** Accepted
**Date:** 2026-07-07
**Track:** U1 — App Foundation (Step 4, Core UI components).

## Context

Before building the shared component library we need durable principles so that components stay
reusable across every future module without redesign or churn. The product owner set explicit rules
for feature independence, scope discipline, component API shape, and accessibility.

## Decision

### 1. Feature independence

- Shared, app-wide UI lives under `src/shared/components/` only: `ui/` for primitives, `patterns/`
  for composites.
- Feature-specific code (`components/`, `hooks/`, `services`/`api`, `schemas/`, `types`, `pages/`)
  stays inside that feature's folder (`src/features/<feature>/…`).
- `shared` **never** imports from any `feature`. Dependencies flow features → shared, never back.

### 2. No unused components

- A component is built only when a **real consumer exists now** (a screen, a Step 7 retrofit, or the
  admin shell) — not speculatively.
- We use **Radix** for behavior-heavy primitives (Dialog, Dropdown Menu, Avatar, Separator) instead
  of re-implementing accessibility.

### 3. Component API contract

Every component must be:

- **Controlled** — accepts value/state props from the parent.
- **Uncontrolled** where it makes sense — sensible internal default state (e.g. `defaultOpen`,
  `defaultValue`) so simple usage needs no wiring.
- **Composition friendly** — forwards `className`, spreads native props/`...rest`, forwards refs
  where relevant, and exposes sub-parts (e.g. `Dialog` + `DialogContent` + `DialogHeader`) rather
  than a single closed component with dozens of props.

### 4. Accessibility is part of Definition of Done

Not a later enhancement. Each component must ship with keyboard support, correct focus management,
`aria-*` semantics, focus trapping for dialogs, and Escape-to-close for overlays.

### 5. API stability

- Any component accepted in U1 has a **stable public API**. Prop names are not renamed per module.
- Future evolution must be **backward compatible** (add optional props; do not break existing ones).

## Component levels (Step 4 scope)

**Level 1 — Core UI (built now, must be very stable):**
`Button`, `Input`, `Label`, `Spinner`, `Badge`, `Avatar`, `Alert`, `Skeleton`, `Dialog`,
`DropdownMenu`, `Separator`, plus a **simple semantic `Table`** primitive
(`table/thead/tbody/tr/th/td` wrappers only — no pagination, sorting, filtering, or selection).

**Level 2 — deferred until a real consumer appears:**
`Pagination`, `DataTableToolbar`, `Search Toolbar`, `Advanced Filters`, `ConfirmDialog`,
`EmptyState`, `LoadingState`, `ErrorState`. (Advanced `DataTable` arrives in M2.)

## Composite patterns must be stateless (Step 5+)

Patterns under `src/shared/components/patterns/` are **pure presentation**. A pattern:

- Is **stateless** as far as possible (local UI-only state such as an uncontrolled dialog's open
  flag is allowed; **no data/business state**).
- Knows **nothing** about Supabase, React Query, or authentication.
- Contains **no business logic** and performs **no data fetching**.
- Holds **no copy of data** — it renders only what it receives via props (SSoT, ADR-0010).

Meaning: `<PageHeader />` does not know the page, `<EmptyState />` does not know why it is empty, and
`<ConfirmDialog />` does not know what it will delete. All of that comes from the feature.

**Financial confirmations exception:** `ConfirmDialog` is for **general** confirmations only. Any
future financial confirmation (collection, reversal, expense, treasury, …) does **not** use
`ConfirmDialog` directly — it goes through the **F1 Financial Approval Foundation** rules
(ADR-0005), so confirmation UI never gets mixed with financial workflow.

## Definition of Done (per component)

A component is **not done** unless:

1. `pnpm build` passes.
2. `pnpm lint` passes.
3. `pnpm typecheck` passes.
4. It works with the keyboard.
5. It supports RTL.
6. It uses **Design Tokens only** (no raw colors / arbitrary values).
7. It has an example on the Design System page (added when Step 6 is implemented).
8. It respects **performance-first** principles (ADR-0010): no unnecessary renders, no duplicate
   state, minimal work on the cashier path.

## Consequences

- Predictable, low-churn components; modules build on top without touching primitives.
- Radix adds a few dependencies but removes hand-rolled a11y risk.
- The Design System page (Step 6) becomes the living contract for every component.
