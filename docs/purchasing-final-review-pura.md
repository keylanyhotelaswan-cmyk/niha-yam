# Suppliers & Purchasing — Final Review (PURA)

**Capability:** Suppliers & Purchasing · Slice **PURA**  
**Date:** 2026-07-15  
**Plan:** [suppliers-purchasing-plan.md](./suppliers-purchasing-plan.md) ✅ Approved 1.0  
**Vision:** [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md) · V-A7…V-A13  
**Environment:** Testing ✅ · **Production ✅** (migrated + frontend deployed 2026-07-15)  
**Verdict:** ✅ **PURA LIVE on Production** · **PURB/PURC still blocked**

---

## 1. Automated results (Testing)

| Check | Result |
| ----- | ------ |
| `pnpm migrate:testing` | ✅ Applied `20260715180000_pura_purchasing.sql` |
| `pnpm test:pura` | ✅ **23 / 23 PASS** |
| `pnpm test:inventory` | ✅ **20 / 20 PASS** (fresh-ingredient isolation) |
| `pnpm test:recipes` | ✅ **18 / 18 PASS** |
| `pnpm typecheck` | ✅ PASS |

### PURA suite coverage

- Supplier upsert + list  
- Reject direct purchase without label  
- Reject supplier source without supplier  
- Direct cash post → receive + treasury `purchase` outflow  
- Supplier cash post (still **no AP**)  
- `standard_cost` unchanged (Q-PUR5)  
- Reverse → stock reverse + treasury credit  
- Double-reverse rejected  
- Cashier denied (`PERMISSION_DENIED` / Q-PUR4)

---

## 2. Delivered (PURA)

| Item | Status |
| ---- | ------ |
| Suppliers master (CRUD / activate) | ✅ |
| Purchase Source = Supplier **XOR** Direct | ✅ |
| Direct (and supplier) **cash** purchase | ✅ |
| Inventory receive via `inv_post_movement('receive')` | ✅ |
| Treasury settlement via `movement_source = purchase` (not expense) | ✅ |
| Admin UI `/admin/purchasing` | ✅ |
| Permissions `purchase.direct.create` · `purchase.supplier.manage` | ✅ owner/manager |
| Audit `purchase.*` | ✅ |
| EGP / ingredients-only / no AP / no cost auto-update | ✅ |
| PO · AP · statement · aging · cost feed | ⏸ **PURB / PURC** |

### Key RPCs

- `pur_upsert_supplier` / `pur_list_suppliers` / `pur_set_supplier_active`  
- `pur_post_direct_cash_purchase`  
- `pur_reverse_direct_cash_purchase`  
- `pur_list_purchases` / `pur_get_purchase`

### Freeze compliance

| Area | Compliance |
| ---- | ---------- |
| POS / Printing / Orders / Reports / Shifts | Untouched (admin nav link only) |
| Treasury core | Glue only — new source value + purchase RPCs; expense path unused for stock |
| Inventory INVA | Receive movements only; no INVB/INVC |
| Recipes | No `supplier_id` on ingredients; no auto `standard_cost` |

---

## 3. Production promote (done 2026-07-15)

| Step | Result |
| ---- | ------ |
| `pnpm migrate:production` | ✅ `20260715180000_pura_purchasing.sql` |
| Frontend deploy | ✅ https://niha-yam.vercel.app · `/admin/purchasing` |
| Smoke (`scripts/smoke-pura-production.mjs`) | ✅ **10 / 10** — supplier · 1 EGP direct buy · stock receive · ledger `purchase` (not expense) · reverse · stock restored |

### Decision: **PURA Production ✅**

PURB / PURC remain **Blocked** until explicit kickoff.

---

## 4. Known notes (non-blocking)

1. Direct cash posts as **executed** in one RPC (F1-shaped settle + reverse), matching cash-market ops; pending→approve split not required for PURA cash.  
2. Default treasury picker prefers **non-drawer cash** (Main) so shift expected-cash math stays clean.  
3. Ledger label added: `movementSource.purchase` = «شراء مخزون».  
4. `test:inventory` now always creates a fresh ingredient so prior receives cannot skew `on_hand` asserts.

---

## 5. Status after this review

| Item | State |
| ---- | ----- |
| PURA on Testing | ✅ Complete |
| PURA Final Review | ✅ This document |
| Production | ✅ Promoted 2026-07-15 (migrate + deploy + smoke) |
| PURB / PURC | ⛔ Blocked |

**Next:** Kickoff PURB only when product owner requests it. PURC remains blocked.

### Ops UX addendum (2026-07-15) — **Production Ready**

- POS → أدوات التشغيل → **حركة مالية جديدة** (مصروف / شراء بضاعة / تحويل).
- Staff flag `can_operational_purchase` independent of supplier admin.
- Same PURA RPCs; no PURB.
- **Testing:** full ops-day simulation 64/64 · [report](./ops-day-simulation-report.md).
- **Production:** migrations `…190000`…`…191200` (incl. readonly UOM fix) · deploy https://niha-yam.vercel.app · smoke `scripts/smoke-ops-purchase-production.mjs` **9/9**.
