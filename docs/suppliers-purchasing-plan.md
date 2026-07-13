# Suppliers & Purchasing — Capability Plan

**Status:** 📝 **Draft — awaiting Review → Approve**  
**Date:** 2026-07-13  
**Capability:** Suppliers & Purchasing (Phase 2 spine #3)  
**Phase Vision:** [NIHA ERP Vision 2.0](./niha-erp-vision-2.0.md) ✅ · Strategy **S1** · §4.3 / **V-A7…V-A13**  
**ADR:** [ADR-0033](./adr/0033-niha-erp-vision-2.0.md) ✅  
**Depends on:** Recipes RCA ✅ · Inventory INVA ✅ · Treasury + F1 (M4) ✅  
**Baseline:** [Operational v1.1](./release-operational-v1.1.md) · **Operational Freeze (final)**  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze

> **No Implement until this Plan is Approved.**  
> All existing Feature Freezes remain in force (POS · Printing · Reports · Recipes · Inventory INVA · Shift Handover · Ops).

---

## 1. Objective

Full procure-to-pay that matches Niha Yam buying reality:

1. **Mode A — Registered supplier** — PO → receive → invoice/AP → statement → dues → pay via F1.  
2. **Mode B — Direct purchase** — market/shop buys without inventing a supplier; still inventory-bound when stock enters.

Money posts **only** through existing Treasury + F1. Purchases are **not** operational expenses (inventory litmus — **V-A12**).

---

## 2. Locked vision principles (do not reopen)

| ID | Rule |
| -- | ---- |
| **V-A7** | Two modes: registered supplier vs direct purchase |
| **V-A8** | Every purchase has a **Purchase Source** (Supplier **or** Direct) |
| **V-A9** | Credit / الآجل **requires** a Supplier — no orphan AP |
| **V-A10 / V-A12** | Stock-bound buy → Purchase; non-stock → existing Expense path |
| **V-A11** | **No Treasury redesign** — Supplier Ledger / Payments / Workflow only |
| **V-A13** | Capability-based purchase permissions (configurable policy) |

Quality bar: supplier **statement ≥ treasury ledger** clarity (Arabic-first).

---

## 3. Scope (when Approved)

### In scope (capability)

| Area | Includes |
| ---- | -------- |
| Suppliers | Master, contacts, terms (mode A) |
| Purchase Source | Supplier or direct label/source (mode B) |
| Purchases / POs | As slices define |
| Goods receipt | Posts Inventory movements (qty) — respects Inventory freeze: extend via Plan-approved hooks only |
| Invoices / AP | Mode A; credit only with Supplier |
| Supplier statement | كشف حساب · running balance (mode A) |
| Aging / dues | Mode A |
| Payments | F1 approve → Treasury ledger |
| Permissions | e.g. `purchase.direct.create`, `purchase.supplier.manage`, `purchase.approve` (exact set in Approve) |
| Audit | Who / what / when at every step |
| Cost feed | Path to update ingredient costs from purchases (slice TBD — must not break Recipes freeze without Plan note) |

### Out of scope (this Plan gate)

- Rewriting Treasury / multi-treasury / F1 core  
- Dummy suppliers for market buys  
- Buying stock through cashier **expense** UI  
- Payroll, Promotions, AI, CRM  
- Reopening ops features under Operational Freeze  
- Inventory valuation / money on Stock Card (INV-20)  
- Auto-PO from AI  

---

## 4. Proposed slices (subject to Approve)

| Slice | Intent | Gate |
| ----- | ------ | ---- |
| **PURA** | Supplier master + Purchase Source model + direct cash purchase → inventory receive + treasury settlement (no AP) | First Implement candidate |
| **PURB** | Registered-supplier PO → GRN → invoice/AP + statement + payment via F1 | After PURA Final Review |
| **PURC** | Aging / dues / print-class statement polish + cost-feed into Recipes standard cost | After PURB |

Exact slice boundaries may be adjusted at **Approve** without changing V-A7…V-A13.

---

## 5. Freezes & integration rules

| Area | Rule |
| ---- | ---- |
| Ops / POS / Printing / Reports | Bug / perf / UX only — Purchasing gets its own admin surfaces |
| Inventory INVA | GRN creates **movements** only; no INVB/INVC scope creep |
| Recipes | Cost updates only via explicit Plan-approved path; no schema break of RC-11 (ingredient ≠ supplier FK on ingredient) |
| Expense UI | Remains for true operating costs; Plan must keep litmus UX clear |
| Cashier | Direct purchase grant optional per V-A13 — default conservative until Approve |

---

## 6. Open questions (must resolve at Review / Approve)

| ID | Question | Options / note |
| -- | -------- | -------------- |
| **Q-PUR1** | PURA first = direct + receive, or supplier master first? | Recommend **PURA** as above |
| **Q-PUR2** | Is PO mandatory for mode A, or allow “buy without PO”? | Ops often needs both |
| **Q-PUR3** | Partial receive / over-receive policy? | Allow with audit vs block |
| **Q-PUR4** | Who may create direct purchases by default? | Owner/manager only vs +cashier |
| **Q-PUR5** | When does purchase update ingredient `standard_cost`? | On receive / on invoice / manual only |
| **Q-PUR6** | Multi-currency? | Assume **EGP only** unless Approve widens |
| **Q-PUR7** | Supplier statement print/export in PURA or PURB? | Recommend PURB minimum; polish PURC |
| **Q-PUR8** | Link purchase lines to inventory items how? | Ingredient SKU only vs also non-ingredient stock items |

---

## 7. Success criteria (Approve + later Final Review)

1. Cannot classify stock buys as expenses through the purchase path.  
2. Credit without Supplier is impossible.  
3. Direct purchases leave a clear audit trail without fake suppliers.  
4. All money movement uses F1 → Treasury.  
5. Supplier statement is operationally usable (balance understandable in Arabic).  
6. Existing freezes unbroken; regression suites still green.  
7. Print Bridge / ops baseline untouched except documented freeze exceptions.

---

## 8. Status

| Item | State |
| ---- | ----- |
| Vision §4.3 | ✅ Locked |
| **This Plan** | 📝 **Draft** — Review → Approve required |
| Implement | ❌ Blocked until Approve |
| Operational Baseline v1.1 | ✅ Defined — [release-operational-v1.1.md](./release-operational-v1.1.md) |

---

## 9. Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **0.1** | **2026-07-13** | Kickoff draft after Operational Freeze / Baseline v1.1 |
