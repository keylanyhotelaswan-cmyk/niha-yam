# Suppliers & Purchasing — Final Review (PURB)

**Capability:** Suppliers & Purchasing · Slice **PURB**  
**Date:** 2026-07-16  
**Plan:** [purchasing-purb-plan.md](./purchasing-purb-plan.md) ✅ Approved  
**Parent:** [suppliers-purchasing-plan.md](./suppliers-purchasing-plan.md)  
**Vision:** [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md) · V-A7…V-A13  
**Environment:** Testing ✅ · **Production ✅** (migrated + frontend deployed 2026-07-16)  
**Verdict:** ✅ **PURB LIVE on Production** · **PURB Feature Freeze** (bug/perf/UX only)

---

## 1. Automated results (Testing)

| Check | Result |
| ----- | ------ |
| `pnpm migrate:testing` | ✅ `20260716180000_purb_credit_supplier_ledger.sql` applied |
| `pnpm test:purb` | ✅ **36 / 36 PASS** |
| `pnpm test:pura` | ✅ **23 / 23 PASS** (regression) |
| `pnpm test:ops-purchase` | ✅ **13 / 13 PASS** |
| `pnpm typecheck` | ✅ PASS |

### PURB suite coverage

- Reject credit without supplier  
- Credit post → inventory receive · **no** treasury hit  
- Supplier open balance + statement  
- Partial payment · settle remaining  
- Treasury `supplier_payment` outflow  
- `HAS_PAYMENTS` blocks credit reverse while payments exist  
- `OVERPAYMENT` rejected  
- Reverse payment restores AP + treasury  
- Reverse credit after payments cleared · double-reverse rejected  
- Cashier denied credit (`PERMISSION_DENIED`)

---

## 2. Delivered (PURB)

| Item | Status |
| ---- | ------ |
| Same Ops dialog: نقدي / آجل | ✅ |
| نقدي = PURA unchanged | ✅ |
| آجل → supplier obligation only (no treasury at buy) | ✅ |
| Supplier required for credit (V-A9) | ✅ |
| Immediate receive (no PO / GRN step) | ✅ |
| سداد المورد (partial/full) via F1 treasury | ✅ |
| كشف حساب + الرصيد الحالي | ✅ |
| عكس السداد / عكس الشراء الآجل | ✅ |
| Audit `purchase.credit_*` · `purchase.supplier_payment_*` | ✅ |
| Admin `/admin/purchasing` credit + ledger | ✅ |
| Permissions `purchase.credit.create` · `purchase.supplier.pay` | ✅ owner/manager |
| Aging · cost feed · PURC | ⏸ **Blocked** |
| Liquidity split · smart handover | ⏸ **Next after PURB promote** |

### Key RPCs

- `pur_post_credit_purchase` / `pur_reverse_credit_purchase`  
- `pur_post_supplier_payment` / `pur_reverse_supplier_payment`  
- `pur_get_supplier_balance` / `pur_get_supplier_statement`  
- `pur_list_supplier_payments`

### Freeze compliance

| Area | Compliance |
| ---- | ---------- |
| No new POS module / screen | ✅ Extended existing financial dialog + admin purchasing |
| Treasury redesign | ✅ No new vault; payment uses existing F1 path |
| Stock buy ≠ expense | ✅ Credit is AP; payment is `supplier_payment` |
| Production | ⏸ Not promoted until owner asks |

---

## 3. Manual smoke (Testing) — recommended before Production

1. Ops → حركة مالية → شراء بضاعة → **آجل** → مورد + أسطر → تأكيد → مخزون يزيد · الخزنة لا تتغير.  
2. Admin → الموردون → كشف الحساب → رصيد = إجمالي الآجل.  
3. سداد جزئي من خزنة → الرصيد ينخفض · حركة `سداد مورد`.  
4. محاولة عكس شراء عليه سداد → رفض.  
5. عكس السداد ثم عكس الشراء → المخزون والرصيد يعودان.  
6. نقدي ما زال يعمل كالسابق (PURA).

---

## 4. Production promote (done 2026-07-16)

| Step | Result |
| ---- | ------ |
| `pnpm migrate:production` | ✅ `20260716180000_purb_credit_supplier_ledger.sql` |
| Frontend deploy | ✅ https://niha-yam.vercel.app · `/admin/purchasing` + Ops نقدي/آجل |
| Smoke (`pnpm smoke:purb-production`) | ✅ **23 / 23** — cash PURA · credit · stock · no treasury on credit · partial/full pay · statement · reverse pay · reverse credit |
| PURA regression smoke | ✅ **10 / 10** |

### Decision: **PURB Production ✅ · Feature Freeze**

| Next | State |
| ---- | ----- |
| إدارة السيولة (تشغيل / رصيد محفوظ) | ⏭ Next capability |
| تقرير استلام وردية ذكي | ⏭ After liquidity |
| **PURC** | ⛔ Blocked until both stabilize |

---

## 5. Status after this review

| Item | State |
| ---- | ----- |
| PURB on Testing | ✅ Complete |
| PURB Final Review | ✅ This document |
| Production | ✅ Promoted 2026-07-16 (migrate + deploy + smoke) |
| **PURB Feature Freeze** | ✅ Bug / perf / UX only |
| PURC | ⛔ Blocked |

---

## 6. Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-16** | PURB Implemented + tested on Testing · Production gated |
| **1.1** | **2026-07-16** | Production promote + smoke 23/23 · Feature Freeze · next = liquidity then handover |
