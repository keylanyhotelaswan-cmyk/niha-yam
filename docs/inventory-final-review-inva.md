# Inventory — Final Review (INVA)

**Capability:** Inventory · Slice **INVA**  
**Date:** 2026-07-12  
**Plan:** [inventory-plan.md](./inventory-plan.md) ✅ Approved  
**Vision:** [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md) · [ADR-0033](./adr/0033-niha-erp-vision-2.0.md)  
**Verdict:** ✅ **INVA APPROVED** · **Inventory Feature Freeze (INVA)** — product owner confirmed 2026-07-12  
**Operating posture:** Live use of INVA; gather ops feedback; **no INVB Implement** until explicit kickoff.

---

## 1. Automated results

| Check | Result |
| ----- | ------ |
| `pnpm test:inventory` | **20 / 20 PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm build` | **PASS** |
| Migration `20260712130000_inva_inventory.sql` | **Pushed** |

### Suite coverage

- Default location  
- Dashboard shape + signals  
- Opening movement  
- Waste + reason required  
- Stock Card on-hand + running balance  
- Reverse movement + double-reverse reject  
- Negative stock allowed with warning  

---

## 2. Delivered (INVA)

| Item | Status |
| ---- | ------ |
| Movements SSOT (no balance column) | ✅ |
| Types: opening, receive, issue, waste, adjustment + reverse | ✅ |
| Stock Card (INV-15 fields) | ✅ |
| Movement detail / source panel (INV-16 ready; order deep-link when source set in INVC) | ✅ |
| Reverse only — no delete (INV-17) | ✅ |
| Dashboard KPIs + top consumed/waste + recent movements/counts (INV-18) | ✅ |
| Alert signal flags for future notifications (INV-19) | ✅ |
| Qty only — no money (INV-20) | ✅ |
| Lots/expiry schema ready, not mandatory (Q-INV7) | ✅ |
| One default location (Q-INV6) | ✅ |
| `/admin/inventory` · `inventory.manage` | ✅ |
| Counts (INVB) / recipe consumption (INVC) | ⏸ Not in INVA |

---

## 3. Freeze contract

**Inventory Feature Freeze (INVA)** starts on approval:

| Allowed | Not allowed |
| ------- | ----------- |
| Bug fixes | New INVA product features |
| Performance | Stock counts (INVB) |
| Simple UX | Recipe consumption (INVC), production, transfers UI, scope creep |

**INVB** is a valid next Inventory slice, but remains **Blocked** and is **not assumed** to be the next kickoff:

1. Run INVA (and RCA) in real ops.  
2. Product owner chooses next work from **observed pain** (may be **INVB** or **Purchasing** per Vision reorder rule).  
3. Explicit kickoff → **Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze**.  
4. **No** migrations/code before that Plan Approve.

Recipes / M6 / M8 freezes untouched. No POS hook in INVA.

---

## 4. Sign-off

| Gate | Result |
| ---- | ------ |
| Scope = INVA only | **PASS** |
| Suites / typecheck / build | **PASS** |
| Product owner confirmation | ✅ **INVA = Approved** · freeze starts now |
| **INVA Approved** | ✅ **2026-07-12** |
| **INVB** | ⏸ **Blocked** — candidate, not auto-started |
| **Live-ops window** | ✅ Active — bug/UX only inside freezes |

**Project ledger snapshot:** Recipes (RCA) frozen · Inventory (INVA) frozen · next Phase 2 kickoff **TBD from live ops**.
