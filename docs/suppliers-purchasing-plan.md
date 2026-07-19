# Suppliers & Purchasing — Capability Plan

**Status:** ✅ **Approved**  
**Date:** 2026-07-13 · **Approved:** 2026-07-15  
**Capability:** Suppliers & Purchasing (Phase 2 spine #3)  
**Phase Vision:** [NIHA ERP Vision 2.0](./niha-erp-vision-2.0.md) ✅ · Strategy **S1** · §4.3 / **V-A7…V-A13**  
**ADR:** [ADR-0033](./adr/0033-niha-erp-vision-2.0.md) ✅  
**Depends on:** Recipes RCA ✅ · Inventory INVA ✅ · Treasury + F1 (M4) ✅  
**Baseline:** [Operational v1.1](./release-operational-v1.1.md) · **Operational Freeze (final)**  
**Project status:** [PROJECT_STATUS.md](../PROJECT_STATUS.md) — `Current Phase: Suppliers & Purchasing`  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze

> **Plan Approved · PURA ✅ Production** · [purchasing-final-review-pura.md](./purchasing-final-review-pura.md)  
> **PURB:** [plan](./purchasing-purb-plan.md) ✅ · [Final Review](./purchasing-final-review-purb.md) ✅ **Production + Feature Freeze** (2026-07-16).  
> **PURC** = next slice (prereqs Liquidity + Smart Handover ✅). Awaiting explicit kickoff.  
> All existing Feature Freezes remain in force. **Deploy rule:** Testing first → Production after verification.

---

## Approval record

| Item | Decision |
| ---- | -------- |
| **This Plan** | ✅ **Approved** (2026-07-15) |
| **Review** | Section-by-section architectural + operational review |
| **Vision §4.3 / V-A7…V-A13** | ✅ Locked — not reopened |
| **Slice order** | PURA → PURB → PURC |
| **Q-PUR1…Q-PUR8** | ✅ Locked (table §6) |
| **First Implement** | **PURA** — ✅ Testing · ✅ **Production** (2026-07-15) |
| **Production** | ✅ Promoted |
| **PURB** | ✅ Production + Feature Freeze — [purchasing-final-review-purb.md](./purchasing-final-review-purb.md) |
| **PURC** | ▶️ Next — awaiting kickoff |

---

## 1. Objective

Full procure-to-pay that matches Niha Yam buying reality:

1. **Mode A — Registered supplier** — PO (optional) → receive → invoice/AP → statement → dues → pay via F1.  
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

## 3. Scope (Approved)

### In scope (capability)

| Area | Includes |
| ---- | -------- |
| Suppliers | Master, contacts, terms (mode A) |
| Purchase Source | Supplier or direct label/source (mode B) |
| Purchases / POs | Per slices; PO optional for mode A (see Q-PUR2) |
| Goods receipt | Posts Inventory **movements** (`inv_post_movement` receive) — INVA only; no INVB/INVC |
| Invoices / AP | Mode A; credit only with Supplier (PURB+) |
| Supplier statement | كشف حساب · running balance (mode A; PURB minimum) |
| Aging / dues | Mode A (PURC) |
| Payments | F1 approve → Treasury ledger |
| Permissions | Named capabilities (exact set in PURA Implement); defaults per Q-PUR4 |
| Audit | Who / what / when at every step |
| Cost feed | **PURC / manual only** — not automatic in PURA/PURB (Q-PUR5) |
| Admin surfaces | **Dedicated admin Purchasing UI** — no new Features inside frozen POS |

### Approve clarifications

1. Purchasing uses its **own admin surfaces**. Frozen POS is not extended with purchasing features (admin nav entrypoint only if needed later, without POS scope creep).  
2. GRN posts **quantity receive movements** under Inventory INVA freeze — no valuation money on Stock Card (INV-20), no INVB/INVC.  
3. Ingredient `standard_cost` updates are **out of PURA/PURB** (manual / PURC).

### Out of scope (this Plan gate)

- Rewriting Treasury / multi-treasury / F1 core  
- Dummy suppliers for market buys  
- Buying stock through cashier **expense** UI  
- Payroll, Promotions, AI, CRM  
- Reopening ops features under Operational Freeze  
- Inventory valuation / money on Stock Card (INV-20)  
- Auto-PO from AI  
- Automatic `standard_cost` updates in PURA/PURB  

---

## 4. Approved slices

| Slice | Intent | Gate |
| ----- | ------ | ---- |
| **PURA** | Supplier master + Purchase Source model + direct cash purchase → inventory receive + treasury cash settlement (**no AP**) | First Implement — **Testing only** |
| **PURB** | Registered-supplier cycle: purchase (± optional PO) → GRN → invoice/AP + statement + payment via F1 | After PURA Final Review |
| **PURC** | Aging / dues / print-class statement polish + cost-feed into Recipes `standard_cost` | After PURB |

Slice boundaries may be refined at Implement kickoff **without** changing V-A7…V-A13 or §6 decisions.

### PURA flow (reference)

```text
PurchaseSource (Supplier | Direct)
        → Direct cash purchase
              → Inventory receive (movement)
              → Treasury cash settlement (F1)
```

- No credit without Supplier (**V-A9**).  
- No expense path for stock-bound goods (**V-A12**).  
- No Treasury core redesign (**V-A11**).

---

## 5. Freezes & integration rules

| Area | Rule |
| ---- | ---- |
| Ops / POS / Orders / Printing / Treasury / Reports / Shifts | Bug / perf / simple UX only — Purchasing gets its own admin surfaces |
| Inventory INVA | GRN creates **movements** only; no INVB/INVC scope creep |
| Recipes | Cost updates only via Q-PUR5 path; no schema break of RC-11 (ingredient ≠ supplier FK on ingredient) |
| Expense UI | Remains for true operating costs; litmus UX must stay clear |
| Cashier | Direct purchase: **not** default in PURA; optional later per V-A13 (Q-PUR4) |
| Environments | **All new work starts on Testing**; promote to Production only after verification |

---

## 6. Review decisions (locked at Approve)

Former open questions — **resolved**:

| ID | Decision |
| -- | -------- |
| **Q-PUR1** | **PURA as planned:** Supplier master + Purchase Source + direct cash purchase → receive + cash treasury settlement (**no AP** in PURA) |
| **Q-PUR2** | Mode A: **buy without PO allowed**; PO optional. Mandatory PO is **not** required for first PURB |
| **Q-PUR3** | **Partial receive allowed** with audit. **Over-receive allowed** with **required reason** + audit (no silent over-receive) |
| **Q-PUR4** | Default: **owner/manager only** for `purchase.direct.create`. Cashier grant via later config (V-A13) — not PURA default |
| **Q-PUR5** | Ingredient `standard_cost`: **manual / PURC only** — no automatic update on receive or invoice in PURA/PURB |
| **Q-PUR6** | **EGP only** |
| **Q-PUR7** | Supplier statement: **minimum in PURB**; print/export polish in **PURC** |
| **Q-PUR8** | Purchase lines in PURA link to **ingredients (INVA stock)** only; non-ingredient stock items deferred |

---

## 7. Success criteria (Approve + later Final Review)

1. Cannot classify stock buys as expenses through the purchase path.  
2. Credit without Supplier is impossible.  
3. Direct purchases leave a clear audit trail without fake suppliers.  
4. All money movement uses F1 → Treasury.  
5. Supplier statement is operationally usable (balance understandable in Arabic).  
6. Existing freezes unbroken; regression suites still green.  
7. Print Bridge / ops baseline untouched except documented freeze exceptions.  
8. Every Implement/experiment runs on **Testing** before any Production promote.  
9. Existing regression suites remain green after each slice.

---

## 8. Status

| Item | State |
| ---- | ----- |
| Vision §4.3 | ✅ Locked |
| **This Plan** | ✅ **Approved** (2026-07-15) |
| Implement **PURA** | ✅ Testing · ✅ **Production** (2026-07-15) · [final review](./purchasing-final-review-pura.md) |
| Implement **PURB** | ✅ Production + Feature Freeze (2026-07-16) |
| Implement **PURC** | ▶️ Ready for kickoff (السيولة + استلام الوردية ✅) |
| Production promote | ✅ Done |
| Operational Baseline v1.1 | ✅ Defined — [release-operational-v1.1.md](./release-operational-v1.1.md) |
| Project status | [PROJECT_STATUS.md](../PROJECT_STATUS.md) |

---

## 9. Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| 0.1 | 2026-07-13 | Kickoff draft after Operational Freeze / Baseline v1.1 |
| **1.0** | **2026-07-15** | **Approved** — § review · Q-PUR1…Q-PUR8 locked · PURA first on Testing · freezes intact |
| **1.1** | **2026-07-15** | PURA Implemented + Final Review on Testing · Production promote gated |
| **1.2** | **2026-07-15** | PURA promoted to Production (migrate + deploy + smoke) · PURB/PURC still blocked |
| **1.3** | **2026-07-16** | PURB Production + Feature Freeze · next liquidity → smart handover · PURC still blocked |
| **1.4** | **2026-07-18** | Liquidity + Smart Handover done · Printing Feature Freeze closed · **PURC** is next (kickoff pending) |
