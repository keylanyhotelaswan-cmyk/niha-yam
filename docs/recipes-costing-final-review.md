# Recipes & Costing — Final Review (RCA)

**Capability:** Recipes & Costing · Slice **RCA**  
**Date:** 2026-07-12  
**Plan:** [recipes-costing-plan.md](./recipes-costing-plan.md) ✅ Approved  
**Vision:** [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md) ✅ Approved · [ADR-0033](./adr/0033-niha-erp-vision-2.0.md)  
**Verdict:** ✅ **RCA APPROVED** · **Recipes Feature Freeze** (RCA scope)

---

## 1. Automated results

| Check | Result |
| ----- | ------ |
| `pnpm test:recipes` | **18 / 18 PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm build` | **PASS** |
| Migrations `20260712120000` + `20260712120100` | **Pushed** (linked) |

### Suite coverage

- UoM bootstrap + seed (g/kg/ml/l/pc/portion)  
- Coverage dashboard shape  
- Ingredient upsert (standard cost)  
- Prep recipe (no menu item)  
- Waste/yield math golden case (100 → 110 → 11)  
- Missing UoM conversion hard-fail  
- g→kg conversion  
- Menu recipe status list  

---

## 2. Delivered (RCA)

| Item | Status |
| ---- | ------ |
| Ingredients master (name_ar/en, code, base UoM, active, standard cost) — **no supplier_id** (RC-11/12) | ✅ |
| Append-only `ingredient_cost_changes` + audit (Q-RC7) | ✅ |
| UoM + conversions; cost mode labeled **standard** | ✅ |
| Recipes by **IDs only** (RC-13); menu-linked + prep (Q-RC3) | ✅ |
| Waste % + yield qty/UoM (Q-RC4/5) | ✅ |
| Professional cost breakdown (RC-15) | ✅ |
| Coverage dashboard (RC-14) | ✅ |
| Admin `/admin/recipes` · nav · `recipes.manage` | ✅ |
| Cost reports **inside** capability; M8 untouched (Q-RC8) | ✅ |
| No inventory / purchasing / AI / promo (RC-16) | ✅ |
| No POS path changes (RC-10) | ✅ |

**Deferred (RCB):** Modifier recipes (Q-RC2).

---

## 3. Principles check

| Principle | Status |
| --------- | ------ |
| RC-1…RC-16 | ✅ |
| Q-RC1…Q-RC8 | ✅ |
| Server-computed cost | ✅ |
| Phase 1 freezes untouched | ✅ |

---

## 4. Sign-off

| Gate | Result |
| ---- | ------ |
| Scope = RCA only | **PASS** |
| Suites / typecheck / build | **PASS** |
| **RCA Approved** | ✅ **2026-07-12** |
| **Recipes Feature Freeze** | ✅ Starts now for RCA — bug / perf / UX only; no new recipe product features without a new Plan (RCB or Inventory hooks need their own Plan) |

**Next (Phase 2 S1):** Inventory **INVA** delivered + frozen ([inventory-final-review-inva.md](./inventory-final-review-inva.md)). **INVB** blocked until explicit kickoff.  
**RCB:** only if ops need modifier recipes after live use of RCA.
