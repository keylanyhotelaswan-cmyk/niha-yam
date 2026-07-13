# Production Chaos & Simulation Suite — Plan

**Status:** ✅ Approved · Final Review complete  
**Date:** 2026-07-13  
**Scope:** Adversarial QA + reliability locks inside Operational Freeze — **not** a capability.  
**After:** Final verdict → Purchasing kickoff.  
**Final review:** [production-chaos-final-review.md](./production-chaos-final-review.md)

## Non-goals

- No Purchasing / new roles / architecture / money-path redesign beyond lock/idempotency fixes.
- No true wall-clock 12h soak in CI — compressed fuzz simulates volume (ops × shift rotations).

## Suites

| ID | Command | Focus |
| -- | ------- | ----- |
| **PC-1** | `pnpm test:chaos` | POS / Shift / Treasury / Print / Call Center / Security |
| **PC-2** | `pnpm test:chaos-fuzz -- --ops 300` | Random ops + consistency invariants |
| **PC-3** | Migration `20260713170000` | reject/cash_drop/transfer/approve locks · remote cash gate |

## Consistency invariants (fuzz end)

- Valid `payment_status` · orders have `shift_id` · unique refs  
- ≤1 open shift · Path A executed handovers have transfer when amount > 0  
- Print claimed queue not exploding · movements have treasury  

## Freeze note

Operational Freeze remains. Fixes are reliability-only.
