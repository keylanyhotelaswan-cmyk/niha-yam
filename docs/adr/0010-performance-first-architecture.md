# ADR-0010: Performance-first architecture

**Status:** Accepted
**Date:** 2026-07-07
**Applies to:** the entire NIHA POS project — every architectural, data, and UI decision, from now
until the end of the project. Highest-priority reference when building the POS (M5) and financial
flows (F1).

## Context

NIHA POS is **not just an admin panel** — it is a tool a cashier uses all day. The project's
**primary goal** is to be the **fastest POS for small and medium restaurants**. Success is measured
first by **speed and smoothness**, then by everything else.

Beauty matters, but **performance and responsiveness matter more**. Every architectural, design, or
UI decision must be evaluated by its effect on:

- Cashier speed
- Responsiveness (perceived latency)
- Payment/collection speed
- Order creation speed
- In-app navigation speed
- Number of clicks/taps
- User waiting time

## Decision

Performance is a **feature** and a **Definition of Done requirement**, not an afterthought. Every
new feature must, from design time, respect the following principles.

### Core principles

1. **Measure before optimize.** Base optimization on real measurements, not guesses.
2. **Every network request must have a reason.** No request without a clear justification.
3. **Avoid duplicate state.** One piece of truth in one place; no mirrored/derived copies that drift.
4. **Avoid unnecessary renders.** Keep component trees and state updates tight.
5. **Prefer simple architecture.** Simple code is easier to measure, reason about, and keep fast.
6. **Performance is a feature.** It is planned, reviewed, and tested like any other requirement.
7. **Cashier workflow has the highest priority.** When trade-offs arise, the cashier path wins.

### Data principles (reinforces the thick-DB / SSoT model)

- **Fewest possible Supabase queries** per screen/action.
- **No unnecessary refetching** — do not reload data without a reason (rely on cache invalidation
  driven by mutations, not blind refetch).
- **No unnecessary cache** — cache only what earns its keep; avoid stale complexity.
- **No summary tables / snapshot tables.** Derive from the single source of truth; do not maintain
  parallel aggregates that can drift (this was a failure mode in the previous system).
- **Single Source of Truth** — PostgreSQL remains authoritative; the client does not become a
  second store of record.
- **Simple, measurable code** — prefer straightforward queries/RPCs that are easy to profile.

### POS experience goals (architectural target now, implemented in M5)

The cashier must feel the system is **instant**:

- Order creation feels instant.
- Opening the payment screen feels instant.
- Recording a collection takes the least possible time.
- **Printing never blocks the cashier** (decoupled queue — see `printing-architecture.md`).
- Heavy operations run in the background when it is safe to do so.

**Honesty rule:** We will **not** build incorrect Optimistic UI (never show success that may not be
true, especially for financial actions — consistent with F1/ADR-0005). Equally, we will **not** add
any wait that provides no value to the user.

## Consequences

- Every plan (per ADR-0009) must state its performance impact on the cashier path; every component's
  Definition of Done (ADR-0008) now includes a performance consideration.
- M5 (POS) and F1 (financial approval) designs are constrained by these goals from the start, not
  retrofitted later.
- Reviews may reject otherwise-correct designs that add clicks, requests, duplicate state, or waits
  without user value.
- This ADR is a **standing reference**: cite it whenever a decision affects speed or the cashier.
