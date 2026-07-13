# ADR-0033: NIHA ERP Vision 2.0 (Phase 2)

**Status:** Accepted (2026-07-12)  
**Date:** 2026-07-12  
**Complements:** [NIHA ERP Vision 2.0](../niha-erp-vision-2.0.md), [ADR-0005](./0005-financial-approval-and-reversal-model.md),
[ADR-0009](./0009-delivery-methodology.md), [ADR-0017](./0017-single-restaurant-scope.md),
[ADR-0020](./0020-operations-first.md), [ADR-0032](./0032-reports-compute-from-source.md).

## Context

Phase 1 closed as **Operational Version 1.0** (M0–M6 + M8) with POS / Printing / Reports feature freezes.
Continuing as an endless M-number chain would under-specify the jump from POS to Restaurant ERP and
risk weak purchasing, optional recipes, or an AI chat without operating guardrails.

## Decision

Accept **[NIHA ERP Vision 2.0](../niha-erp-vision-2.0.md)** as the governing Phase 2 reference:

1. **Strategy S1 — Cost & Stock Spine**, with logical order:  
   Recipes & Costing → Inventory → Suppliers & Purchasing → Payroll & HR → Promotions → AI Operating Assistant.  
   After Inventory, reorder is allowed from live ops pain; still Plan-gated.
2. **Recipes & Costing is the backbone** of product cost/margin truth.
3. **Suppliers & Purchasing** is full procure-to-pay; supplier statement quality ≥ treasury ledger; money via **F1** only.
   **Purchase Source** may be Supplier or direct; **credit requires Supplier**; **inventory litmus** (enters stock ⇒ Purchase, else Expense);
   cashier expense UI is never the stock-buy path; direct-purchase ACL is policy-configurable.
4. **Payroll** full cycle; payouts via **F1** only.
5. **Promotions** is a flexible rules engine; must remain **loyalty/CRM-ready**.
6. **AI Operating Assistant** — Arabic ops assistant; **no** silent financial/operational execute; confirm + ACL.
7. **CRM & Customer Engagement** is an explicit **Phase 2 backlog** capability (not current spine execution).
8. **Live Ops UX / Shift Archive / Handover** (§4.8 / V-A14…V-A24) is documented backlog:
   Orders Hub action queue, Shift Archive without DB purge, retention = UI filter only,
   **Shift Handover** complete F1 cycle: Pending → Receive → Approval → Transfer
   (to Main or next-shift Opening Float), mandatory receive cards, reject/discrepancy path,
   admin notifications, **no bypass** / one handover per shift, **no direct Main posting** for shift cash.
   **Not** current Implement; does not break Phase 1 freezes.
9. Methodology: **Capability Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze**.  
   No Implement without Plan Approve.
10. **First Capability Plan:** Recipes & Costing.

Phase 1 freezes remain in force except narrow, Plan-approved integration hooks.

## Consequences

- All Phase 2 work is judged against Vision 2.0 before coding.  
- Inventory auto-deduct and deep AI cost analysis wait on Recipes.  
- Purchasing Plans must meet the statement/F1 quality bar or fail Review.  
- Promotions/AI Plans must preserve CRM extension hooks.  
- **Ledger (2026-07-12):** Recipes RCA ✅ frozen · Inventory INVA ✅ frozen · next Phase 2 kickoff TBD (INVB or Purchasing).  
- **Ops amendments (Vision 1.2–1.6):** Purchase Source / litmus / purchase perms (V-A7…V-A13);
  live-ops UX (V-A14…V-A17); **Shift Handover** complete F1 cycle including mandatory receive,
  next-shift confirm, and no-bypass (V-A18…V-A24) — Vision only until OES.  
- **OES (2026-07-13):** Shift Handover ✅ **Approved + Feature Freeze** — [final review](../shift-handover-final-review.md) · [ADR-0034](./0034-shift-handover-f1.md).
