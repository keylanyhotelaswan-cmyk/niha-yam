# Inventory — Capability Plan

**Status:** ✅ **Approved** (2026-07-12) — Inventory Plan locked · **INVA closed**  
**Date:** 2026-07-12 · **Approved:** 2026-07-12  
**Capability:** Inventory (Phase 2 — second backbone after Recipes)  
**Phase Vision:** [NIHA ERP Vision 2.0](./niha-erp-vision-2.0.md) ✅ Approved · Strategy **S1**  
**ADR:** [ADR-0033](./adr/0033-niha-erp-vision-2.0.md) ✅ Accepted  
**Depends on:** Recipes RCA ✅ · **Recipes Feature Freeze**  
**Respects freezes:** Recipes · M6 · M8 · POS (INVC hook only, later)  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze

> **INVA = Approved + Feature Freeze.** No new INVA product features (bug / perf / UX only).  
> **INVB = next active spine item, but Blocked** — no Implement, no migrations, no count UI until product owner **explicitly starts INVB** and any required Plan gate is Approved.  
> Live ops first: review real Stock Card / Dashboard / posting / perf / UX feedback before expanding scope.

---

## Approval record

| Item | Decision |
| ---- | -------- |
| **Plan** | ✅ **Approved** (2026-07-12) |
| **Q-INV1** | ✅ Recipe deduct after current official sale event; fully **idempotent** |
| **Q-INV2** | ✅ Same DB transaction while perf allows; outbox only if perf proves need |
| **Q-INV3** | ✅ Negative stock allowed in INVA with **warning only** (no sale block); policy may become settings later |
| **Q-INV4** | ✅ Count with variance → manager approve; zero variance → auto-close |
| **Q-INV5** | ✅ Opening balance = **opening movement** only |
| **Q-INV6** | ✅ **One** default location in INVA; multi-location schema-ready |
| **Q-INV7** | ✅ Batch/expiry columns ready; **not** mandatory now |
| **Q-INV8** | ✅ Void/refund → **reverse movement** linked to original |
| **Q-INV9** | ✅ Production → **INVD** |
| **Q-INV10** | ✅ “No movement” = **14 days** (configurable later) |
| **Q-INV11** | ✅ Inventory admin = owner/manager only; cashier has no Inventory manage |
| **Q-INV12** | ✅ Slices **INVA → INVB → INVC** only; defer INVD–INVF |
| **INV-15** | ✅ Stock Card = treasury-ledger quality (datetime, type, ref, user, in, out, balance after, reason) |
| **INV-16** | ✅ Open movement → navigate to source (order / count / waste / receive / adjustment) when present |
| **INV-17** | ✅ **No delete** of stock movements; corrections = reverse only (F1 philosophy) |
| **INV-18** | ✅ Dashboard also: top consumed, top waste, recent movements, recent counts (cards may fill across slices) |
| **INV-19** | ✅ Notification-ready signals; **no** notification Implement in Inventory now |
| **INV-20** | ✅ Inventory = **qty only**; no financial valuation / waste P&amp;L in this capability |
| **Implement** | ✅ **INVA done** · INVB ⏸ Blocked until explicit kickoff |

### Locked principles (INV-1 … INV-20)

| ID | Principle |
| -- | --------- |
| **INV-1…14** | As in Vision Plan (movements SSOT, Stock Card, recipe-driven consumption, freezes, qty≠money, …) |
| **INV-15** | Stock Card professional fields (incl. actor + reason) |
| **INV-16** | Deep-link from movement to source document |
| **INV-17** | Append-only + reverse only (no DELETE) |
| **INV-18** | Rich dashboard cards (consumption, waste, recent activity) |
| **INV-19** | Future alerts must not require redesign |
| **INV-20** | Strict qty/finance separation |

---

## Slices (execution gate)

| Slice | Status |
| ----- | ------ |
| **INVA** | ✅ **Approved + Feature Freeze** — [inventory-final-review-inva.md](./inventory-final-review-inva.md) |
| **INVB** | ⏸ **Blocked** — counts candidate; kickoff only after live ops + explicit request (Purchasing may take priority per Vision §5.2) |
| **INVC** | ⏸ After INVB — recipe consumption on sale |
| **INVD–F** | ⏸ Deferred |

---

## INVA out of scope (frozen)

During INVA freeze / live ops: **no** stock counts, recipe auto-deduct, production, transfers UI, mandatory lots, Purchasing, AI, money/valuation, or Phase 1 freeze breaks.  
Ops feedback on Stock Card / Dashboard / posting / perf / UX → **bug or simple UX only**.

---

## Status

| Item | State |
| ---- | ----- |
| Inventory Plan | ✅ Approved |
| **Recipes (RCA)** | ✅ Approved + **Recipes Feature Freeze** |
| **INVA** | ✅ **Approved (2026-07-12)** + **Inventory Feature Freeze (INVA)** |
| **INVB** | ⏸ **Next capability · Blocked** until explicit kickoff |
| INVC–F | ⏸ Deferred |

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| 0.1 | 2026-07-12 | Draft |
| 1.0 | 2026-07-12 | Approved — Q-INV* + INV-15…20 · INVA Implement |
| **1.1** | **2026-07-12** | Product owner confirmed INVA Approved + freeze; INVB blocked pending live ops / explicit start |
