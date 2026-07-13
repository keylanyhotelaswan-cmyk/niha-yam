# ADR-0032: Reports compute from source (official vs operational)

**Status:** Accepted (2026-07-12) — locked with [M8 Reports Plan](../m8-reports-plan.md)  
**Date:** 2026-07-12  
**Complements:** [ADR-0005](./0005-financial-approval-and-reversal-model.md), [ADR-0013](./0013-multi-treasury-foundation.md),
[ADR-0025](./0025-revenue-collection-approval.md), [ADR-0028](./0028-pending-expense-approval-lifecycle.md),
[ADR-0017](./0017-single-restaurant-scope.md).

## Context

M4–M6 delivered the operational loop (treasury, orders, printing). Management needs **Reports (M8)**
without introducing a second financial truth. Historical temptation in POS systems is to build
`daily_sales` / snapshot tables that drift from the ledger.

ADR-0025 already distinguishes **official (approved ledger)** revenue from **operational drawer**
balances that include pending collections/expenses. Reports must not collapse those modes.

## Decision

> **M8 Reports are read-only views computed from source tables via SQL RPCs.**  
> There are **no summary/aggregate tables as SSOT**.  
> Every money-facing report declares its **mode**: **official** or **operational** (or non-financial **ops**).

### Rules

1. **Official** KPIs use approved ledger movements / approved collections only.  
2. **Operational** KPIs (drawer-style) are allowed only when labeled; never as default “revenue”.  
3. Pending collections and pending expenses never inflate official sales or official balances.  
4. Reversals remain visible (append-only); reports do not rewrite history.  
5. UI does not implement balance math; RPCs do.  
6. Single-restaurant scope only.  
7. Cancelled / voided orders never enter official sales (separate section/column only).  
8. Landing **ملخص اليوم** composes the same helpers as detail reports — no second formula path.

## Consequences

- M8 Implement may add report RPCs and indexes, but not rollup SSOT tables.  
- TanStack Query caching is presentation-only and must not be treated as financial truth.  
- Future BI/warehouse (if ever) is a separate decision and must not replace ledger SSOT.  
- Aligns M8 with F1 / multi-treasury foundations without waiting for a shared “approval engine” UI.  

## Follow-up (2026-07-12)

M8 module **Approved** with **Reports Feature Freeze** — see [m8-final-review.md](../m8-final-review.md).  
System treated as **Operational Version 1.0**; next priorities from live ops, not roadmap assumptions.

### Phase 2 ledger (same day)

- [NIHA ERP Vision 2.0](../niha-erp-vision-2.0.md) ✅  
- Recipes **RCA** ✅ + freeze  
- Inventory **INVA** ✅ + freeze  
- **INVB** ⏸ next-but-blocked until explicit start  
- M8A ships before M8B; freezes on M5/M6 remain intact.
