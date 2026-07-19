# PURB — Credit Purchases & Supplier Ledger · Plan

**Status:** ✅ **Approved** — Implement on Testing  
**Date:** 2026-07-16 · **Approved:** 2026-07-16  
**Capability:** Suppliers & Purchasing · Slice **PURB**  
**Parent Plan:** [suppliers-purchasing-plan.md](./suppliers-purchasing-plan.md) ✅ Approved  
**PURA Final Review:** [purchasing-final-review-pura.md](./purchasing-final-review-pura.md) ✅ Production  
**Vision:** [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md) · **V-A7…V-A13** locked  
**Environment:** ✅ **Production** (2026-07-16) · **PURB Feature Freeze**  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze

> **PURB complete.** PURC remains **Blocked**.  
> Next: liquidity management → smart shift handover.  
> All Feature Freezes remain in force (POS / Orders / Printing / Treasury / Reports / Shifts / Recipes / Inventory INVA / **PURB**).

---

## 0. Architectural & operational review (before Approve)

### 0.1 What PURA already gives us

| Piece | Today |
| ----- | ----- |
| Supplier master | ✅ |
| Purchase Source = Supplier **XOR** Direct | ✅ |
| Cash purchase → inventory receive + treasury `purchase` | ✅ |
| Ops dialog «حركة مالية جديدة» → شراء بضاعة | ✅ (cash only) |
| Admin `/admin/purchasing` | ✅ |
| Reverse cash purchase | ✅ |
| AP / statement / supplier payments | ❌ |

Constraint already in schema: `purchases.payment_method` **cash-only**. PURB must widen this carefully without breaking PURA cash path.

### 0.2 Product owner philosophy (this kickoff) — accepted as PURB intent

| Principle | Meaning |
| --------- | ------- |
| **No new complex module** | Extend the **current buy cycle**, not invent a separate AP app |
| **Same UX** | Inside **شراء بضاعة**: choose **نقدي** or **آجل** |
| **نقدي** | Existing **PURA** path unchanged |
| **آجل** | **PURB** path — supplier debt + statement + payments |
| **Ops-first** | Cashier/manager records the buy once; ledger follows |

This **narrows** the parent plan’s PURB wording (“PO → GRN → invoice”) for the **first PURB Implement**:

- **PO is out** of first PURB (already allowed by **Q-PUR2**: buy without PO).  
- **Separate GRN step is out** of first PURB: credit buy still **receives stock immediately** (same as cash) — one operational action.  
- **Invoice** in first PURB = the **credit purchase document itself** (obligation created at post), not a second invoice screen.

Aging, print polish, cost feed → **PURC** (unchanged).

### 0.3 Fit to locked vision

| Rule | PURB compliance |
| ---- | --------------- |
| **V-A9** | آجل **requires** Supplier — direct + credit **forbidden** |
| **V-A11** | No Treasury redesign — payments via F1 → existing ledger |
| **V-A12** | Stock buy ≠ expense; credit buy still `purchase` / AP, never expense |
| **V-A8** | Source remains Supplier for credit; Direct stays cash-only |
| **Q-PUR5** | No auto `standard_cost` |
| **Q-PUR6** | EGP only |
| **Q-PUR7** | Minimum statement in PURB |

### 0.4 Risks called out before Approve

1. **Ops UX vs Freeze:** Extending «حركة مالية جديدة» with نقدي/آجل is a **simple UX** on an existing ops surface (allowed). Must not become a new POS Feature module.  
2. **Cashier credit:** Credit/AP should stay **tighter** than cash (Vision V-A13). Default proposal: credit = owner/manager only unless a named capability is granted.  
3. **AP balance:** Must be **computed** (purchases − payments − reversals), never a writable balance column.  
4. **Partial payments:** Required in PURB (real ops).  
5. **Reverse:** Credit purchase reverse and payment reverse must both restore stock/AP/treasury correctly with audit.

---

## 1. Objective (PURB)

Complete the **on-credit** half of buying stock from a **registered supplier**, without changing how cash buys work:

1. Post **credit purchase** → stock in + supplier obligation (AP).  
2. See **current balance** and **كشف حساب**.  
3. Record **supplier payments** (full/partial) via F1 → Treasury.  
4. **Reverse** payment (and credit purchase when allowed) with full audit.

---

## 2. In scope / Out of scope

### In scope (PURB)

| Area | Includes |
| ---- | -------- |
| Settlement choice | **نقدي** (PURA) · **آجل** (PURB) on the same purchase UI |
| Credit purchase | Supplier required · lines = ingredients · receive stock now · create AP |
| Supplier liability | Obligation linked to purchase · running balance |
| Payments | Full / partial · F1 → treasury outflow · `movement_source` for supplier payment (exact name in Implement) |
| Statement | Arabic كشف حساب: purchases, payments, reversals, running balance, current balance |
| Reverse | Reverse credit purchase (stock + AP) · reverse payment (treasury + AP) |
| Audit | Who / what / when on post, pay, reverse |
| Permissions | Named capabilities (see §6) |
| Surfaces | Ops dialog settlement toggle · Admin supplier statement / pay · list purchases show نقدي/آجل |
| Environment | **Testing only** until promote |

### Out of scope (explicit)

| Area | Deferred to |
| ---- | ----------- |
| Purchase Orders (PO) | Later / never in first PURB |
| Separate GRN / invoice workflow screens | Later if needed |
| Aging / أعمار الديون / due dates polish | **PURC** |
| Recipe `standard_cost` feed | **PURC** |
| Supplier analytics / ranking | **PURC** / backlog |
| Multi-currency | Never in PURB (Q-PUR6) |
| Direct + آجل | **Forbidden** (V-A9) |
| Dummy suppliers | Forbidden |
| Treasury / F1 core redesign | Forbidden (V-A11) |
| Stock as expense | Forbidden (V-A12) |

---

## 3. Operational flows

### 3.1 Same dialog — settlement branch

```text
حركة مالية جديدة → شراء بضاعة
  ├── مصدر: سوق مباشر | مورد
  ├── بنود المكونات + كميات + أسعار
  └── طريقة السداد:
        ├── نقدي  → PURA (treasury required)     [existing]
        └── آجل   → PURB (supplier required)     [new]
```

**Rules**

| Settlement | Source | Treasury at buy | Stock | AP |
| ---------- | ------ | --------------- | ----- | --- |
| نقدي | Direct or Supplier | Required | Receive now | No |
| آجل | **Supplier only** | Not required at buy | Receive now | Yes (total) |

Reject at RPC:

- آجل + Direct → error (Arabic).  
- آجل without supplier → error.  
- نقدي without treasury → error (PURA today).

### 3.2 Credit purchase post (atomic)

```text
pur_post_credit_purchase (name indicative)
  → validate supplier + lines + permission
  → insert purchase (payment_method = credit, status = executed)
  → inventory receive (same path as PURA / ops purchase receive)
  → insert AP obligation (or equivalent ledger rows)
  → audit
  → NO treasury movement at buy time
```

### 3.3 Supplier payment

```text
pur_post_supplier_payment
  → amount > 0 · ≤ open balance (or allow overpay? → Q-PURB3)
  → F1-shaped execute → treasury outflow
  → allocate to open obligations (FIFO default — Q-PURB4)
  → audit
```

### 3.4 Reverse

| Action | Effect |
| ------ | ------ |
| Reverse credit purchase | Reverse stock receive · void/reverse AP · audit · block if payments allocated (or auto-unallocate — Q-PURB5) |
| Reverse payment | Reverse treasury movement · restore AP open amount · audit |

### 3.5 Statement (minimum)

Arabic list for one supplier, newest or chronological (Implement chooses one, document it):

- Opening balance (period or all-time — Q-PURB6)  
- Credit purchases (+)  
- Payments (−)  
- Reversals  
- Running balance  
- **Current balance** header

Quality bar: as clear as treasury ledger for a non-accountant manager.

---

## 4. Data model direction (Implement detail later)

Indicative — not Implement-ready DDL:

| Concept | Role |
| ------- | ---- |
| `purchases.payment_method` | Extend: `cash` \| `credit` (drop cash-only check) |
| `purchases.treasury_id` | Nullable when `credit` |
| Supplier AP document / lines | Obligation from credit purchase; computed open amount |
| Supplier payment header + allocations | Links payment → obligations |
| Treasury | Reuse movements; new `movement_source` value for supplier payment (not `expense`, not cash `purchase` confusion) |

**Invariant:** Supplier balance = Σ credit purchases − Σ payments ± reversals (computed).

---

## 5. UX surfaces

| Surface | Change |
| ------- | ------ |
| Ops «شراء بضاعة» | Add **طريقة السداد: نقدي / آجل**; hide treasury when آجل; force supplier when آجل |
| Admin Purchasing | Show settlement on purchase list; supplier page: balance + statement + «تسجيل دفعة» |
| POS Feature Freeze | No new POS module — only settlement UX on existing financial dialog |
| Printing | No Bridge/template work in PURB unless statement print is trivial later (prefer PURC) |

---

## 6. Permissions (proposal)

| Capability | Default | Notes |
| ---------- | ------- | ----- |
| `purchase.direct.create` / ops cash | Unchanged (PURA + `can_operational_purchase`) | نقدي |
| `purchase.credit.create` | Owner/manager | آجل post |
| `purchase.supplier.pay` | Owner/manager | Payments |
| `purchase.supplier.statement` | Owner/manager (read) | كشف حساب |
| Reverse credit / reverse pay | Owner/manager | Audit required |

Cashier **آجل** not default (V-A13 credit stays tighter).

---

## 7. Decisions to lock at Approve (Q-PURB)

| ID | Question | Proposal for Approve |
| -- | -------- | -------------------- |
| **Q-PURB1** | First PURB = credit buy + AP + pay + statement **without PO / without separate GRN**? | **Yes** — aligns with ops philosophy |
| **Q-PURB2** | آجل allowed for Direct? | **No** — V-A9 |
| **Q-PURB3** | Overpayment (pay more than balance)? | **Reject** — simplify |
| **Q-PURB4** | Allocation when multiple open buys? | **FIFO** by purchase date |
| **Q-PURB5** | Reverse credit purchase after partial payment? | **Block** until payment(s) reversed |
| **Q-PURB6** | Statement period | **All-time** minimum; date filter optional nice-to-have |
| **Q-PURB7** | Ops dialog may post آجل? | **Yes** for users with `purchase.credit.create` (manager default) |
| **Q-PURB8** | Testing-only until Final Review + promote ask? | **Yes** |

---

## 8. Success criteria (Final Review later)

1. نقدي path still green (`test:pura` / ops purchase unchanged).  
2. آجل without supplier impossible.  
3. Direct + آجل impossible.  
4. Credit buy increases stock and supplier balance; **no** treasury hit at buy.  
5. Payment decreases balance and posts treasury correctly (not expense).  
6. Partial payment works; overpay rejected.  
7. Reverse payment restores AP + treasury.  
8. Reverse credit blocked while payments remain.  
9. Statement shows correct running + current balance in Arabic.  
10. Freeze suites still green; no Production until asked.  
11. No PO / aging / cost feed shipped.

---

## 9. Implement order (after Approve only)

1. Schema + RPCs (credit post, pay, reverse, statement, balance) on **Testing**.  
2. Ops dialog: نقدي/آجل branch.  
3. Admin: statement + pay.  
4. `pnpm test:purb` scenarios.  
5. Regression: `test:pura` · `test:ops-purchase` · `test:inventory`.  
6. Final Review doc → Feature Freeze for PURB slice.  
7. Production **only** on explicit ask.

---

## 10. Status

| Item | State |
| ---- | ----- |
| Parent Plan | ✅ Approved |
| PURA | ✅ Production |
| **This PURB Plan** | ✅ **Approved** (2026-07-16) |
| Implement PURB | ✅ Done · [Final Review](./purchasing-final-review-purb.md) |
| Production PURB | ✅ Promoted 2026-07-16 · smoke 23/23 |
| **PURB Feature Freeze** | ✅ Bug / perf / UX only |
| PURC | ⛔ Blocked |
| Next | Liquidity split → smart shift handover |

---

## 11. Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **0.1** | **2026-07-16** | Kickoff draft from owner philosophy: نقدي/آجل in same buy flow · no PO · AP+pay+statement · Review for Approve |
| **1.0** | **2026-07-16** | **Approved** — Q-PURB1…Q-PURB8 as proposed · Implement Testing · Liquidity + smart handover after PURB · PURC still blocked |
| **1.1** | **2026-07-16** | Production promote + Feature Freeze · smoke 23/23 · next = liquidity then handover |

---

## Approve checklist (owner)

Please confirm or amend **Q-PURB1…Q-PURB8**, then reply:

**«اعتمد خطة PURB»**

After Approve, Implement starts on Testing only.
