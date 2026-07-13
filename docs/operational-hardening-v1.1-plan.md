# Operational Hardening v1.1 — Plan

**Status:** ✅ Approved · Final Review complete  
**Date:** 2026-07-13  
**Scope:** Hardening + QA + Bug Fix inside current ops freeze — **not** a new capability.  
**After:** Production Ready verdict → Purchasing kickoff.  
**Final review:** [operational-hardening-v1.1-final-review.md](./operational-hardening-v1.1-final-review.md)

## Non-goals

- No Purchasing / INVB / new roles / new money paths / architecture changes.
- No reopening Feature Freeze except bug / reliability / stress coverage.

## Slices

| ID | Slice | Outcome |
| -- | ----- | ------- |
| **OH-1** | Shift summary bug | ✅ Cashier = open shift only; manager day toggle; status aggregates scoped |
| **OH-2** | Orders stress | ✅ `pnpm test:oh-orders` · 18/18 (×50) |
| **OH-3** | Print stress | ✅ `pnpm test:oh-print` · 20/20 (burst 40) |
| **OH-4** | Shift stress + scenarios | ✅ `pnpm test:oh-shift` · 30/30 |
| **OH-5** | Reliability | ✅ Locks · idempotent receive · day RPC gated |
| **OH-6** | Deliverable report | ✅ Final review · Production Ready |

## OH-1 — locked design

- Default scope: **shift** when open shift exists.
- Day scope: managers only; RPC `get_day_collection_totals` (manager-gated).
- Collection status (paid / unpaid / partial) must use the **same scope** as payment-method totals (not calendar-day order list).
- Hub KPI counts use **open-shift hub list**, not day-wide orders.

## Freeze note

Operational Freeze remains: this sprint only hardens ops for production confidence.
