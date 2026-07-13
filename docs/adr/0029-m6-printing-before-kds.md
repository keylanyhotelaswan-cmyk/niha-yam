# ADR-0029: M6 is Printing & Order Execution (KDS deferred)

**Status:** Accepted
**Date:** 2026-07-10
**Supersedes (roadmap only):** prior `modules.md` ordering where M6 = Kitchen Display (KDS) and
M7 = Printing.
**Complements:** [ADR-0020](./0020-operations-first.md), [ADR-0024](./0024-order-lifecycle-three-dimensions.md),
[printing-architecture.md](../printing-architecture.md).

## Context

M5 is **Approved** with a POS feature freeze. The previous roadmap put **Kitchen Display (KDS)** as
M6 and **Printing** as M7.

Niha Yam’s real floor workflow is traditional paper:

1. Cashier finalizes the order.
2. Two tickets print immediately — **kitchen** (no prices) and **customer** (full financials).

There is no operational need for a KDS screen now. Building KDS first would add Realtime UI
complexity without matching how the restaurant works today, and would delay the print path that
already has schema stubs (`print_jobs`, `kitchen_tickets`, `reprint_order`) from M5.

## Decision

> **Next module is M6 — Printing & Order Execution**, not Kitchen Display.

| # | Module | Role |
| - | ------ | ---- |
| **M6** | **Printing & Order Execution** | Printers, templates, auto-print on finalize, reprint + audit, durable queue/retry, printer health |
| **M7** | Kitchen Display (KDS) | **Deferred / optional** — consumes the same order events / print-job stream; no rewrite of M6 |
| **M8** | Reports | Unchanged |

### Architecture lock

```
POS / Order RPCs
      │
      ▼
Order Events + Print Jobs (SSOT intent)
      │
 ┌────┴────┐
 │         │
 ▼         ▼
Printing   Kitchen Display (future M7)
(M6)
```

- Printing is the **primary execution surface** for the kitchen today.
- KDS, if ever needed, is a **consumer** of the same events/jobs — not a second source of truth.
- M5 freeze remains: no new POS features; M6 may only touch POS for print status / reprint UX hooks
  required by printing.

### M6 scope (locked intent — detailed plan in module Plan gate)

1. **Printer registry** — cashier, kitchen; extensible (bar, pastry, …).
2. **Templates** — customer receipt (financial) vs kitchen ticket (items/qty/modifiers/notes/type; no prices).
3. **Auto-print** on successful `finalize_sale` / kitchen-needed create paths → enqueue jobs → print both tickets without cashier taps.
4. **Reprint** from order detail — who / when / count / reason → timeline + `audit_log`.
5. **Queue** — offline/disconnected printer: job retained, retry, health alert; sale never rolls back on print failure ([printing-architecture.md](../printing-architecture.md)).

## Consequences

- Aligns with **Operations First** (ADR-0020) and the three-dimension model (ADR-0024): print is
  already an independent axis; M6 **executes** what M5 **enqueues**.
- No conflict with ADR-0026 (edit/review stays in M5C; must not move into KDS or printing).
- `docs/modules.md`, `printing-architecture.md` implementation target, and stale “M7/M8 print”
  references are updated to **M6**.
- Open question Q5 (Arabic ESC/POS code page) moves to the **M6** gate.
- KDS remains available later without redesigning order/print foundations.
