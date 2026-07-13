# ADR-0020: Operations First — design for how the restaurant runs

**Status:** Accepted
**Date:** 2026-07-08
**Complements:** [ADR-0010](./0010-performance-first-architecture.md) (Performance First — technical
expression of cashier speed), [ADR-0017](./0017-single-restaurant-scope.md) (single-restaurant scope).

## Context

NIHA POS is built for **one restaurant's daily operation**, not as a generic admin SaaS. Modules were
re-sequenced operations-first (Menu → Treasury → POS → **Printing** → optional KDS → Reports;
[ADR-0029](./0029-m6-printing-before-kds.md)). Yet it is still
possible to design a module that is technically clean but awkward at the counter, in the kitchen, or
during rush hour.

**Performance First (ADR-0010)** answers: _"Does this make the cashier faster or slower?"_ at the
implementation level (requests, renders, cache).

**Operations First** answers a broader question first: _"Does this match how Niha Yam actually runs,
and will it make service faster and simpler for staff?"_

## Decision

Adopt **Operations First** as a project-wide design principle:

> Every new design decision is evaluated **first** from the perspective of restaurant operation speed
> and ease (cashier, kitchen, manager during service), **then** from developer convenience.

### Rules

1. **POS is the consumer of truth.** Admin modules (e.g. Menu) exist to configure what POS/Kitchen/Printing
   will read. Schema fields, RPCs, and UI must include operational flags from day one — not added later
   as migrations on a "catalog-only" model.
2. **No catalog-only shortcuts.** If a field will be needed at the counter (visibility, sort order,
   kitchen routing, print routing, modifiers, discounts), it belongs in the module that introduces the
   product — typically M3 Menu — even if POS UI ships in M5.
3. **Sort by numbers, not drag-and-drop** for operational ordering (categories, menu items, modifier
   options) unless a strong operational case exists for DnD. Numbers are faster to set, auditable, and
   stable under RTL.
4. **Build complete operational subsystems when they are core to service** (e.g. full modifier groups
   in M3, not a stripped MVP), as long as scope stays single-restaurant and does not add SaaS complexity.
5. **Developer ergonomics are second.** Prefer an extra column or RPC today over a refactor blocking
   POS launch tomorrow.

### Relationship to Performance First

| Lens              | Question                                             | When                         |
| ----------------- | ---------------------------------------------------- | ---------------------------- |
| Operations First  | Is this how the restaurant works? Will staff get it? | Plan + schema + UX decisions |
| Performance First | Is the runtime path minimal for the cashier?         | Implementation + review      |

Both must pass. Operations First chooses _what_; Performance First ensures _how fast_.

## Consequences

- M3 Menu includes POS-oriented fields (`show_in_pos`, sort order, kitchen/print flags, modifier/discount
  flags) even though POS UI is M5.
- Future modules (Treasury, Kitchen, Printing) are reviewed against operational scenarios, not only ER
  diagrams.
- Plans must state how each deliverable is consumed by the next operational module in the chain.
