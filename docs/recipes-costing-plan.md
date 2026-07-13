# Recipes & Costing — Capability Plan

**Status:** ✅ **Approved** (2026-07-12) — RCA Implement authorized  
**Date:** 2026-07-12 · **Approved:** 2026-07-12  
**Capability:** Recipes & Costing (Phase 2 backbone)  
**Phase Vision:** [NIHA ERP Vision 2.0](./niha-erp-vision-2.0.md) ✅ Approved · Strategy **S1**  
**ADR:** [ADR-0033](./adr/0033-niha-erp-vision-2.0.md) ✅ Accepted  
**Depends on:** M3 Menu ✅ · Phase 1 freezes intact  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review → Feature Freeze

> **Plan Approved.** Implement **RCA only**. **RCB** only if needed after RCA Final Review.  
> **RC-16:** Cost engine only — no inventory deduct, purchasing, suppliers UI, AI, or promotions.

---

## Approval record

| Item | Decision |
| ---- | -------- |
| **Plan** | ✅ **Approved** (2026-07-12) |
| **Q-RC1** | ✅ Standard Cost in RCA; Cost Mode always visible; schema ready for Last Purchase / Moving Average later |
| **Q-RC2** | ✅ Slice A = recipe on parent menu item only; modifier recipes → **RCB** |
| **Q-RC3** | ✅ Prep recipes from day one (no menu item); **no** inventory posting in RCA |
| **Q-RC4** | ✅ Waste = % on recipe (RCA) |
| **Q-RC5** | ✅ Yield = quantity + UoM |
| **Q-RC6** | ✅ Items without recipe allowed; UI shows **لا توجد وصفة**; future inventory deduct requires a recipe |
| **Q-RC7** | ✅ Append-only ingredient cost change log + audit |
| **Q-RC8** | ✅ Cost reports inside this capability; **M8 untouched** (feature freeze) |
| **RC-11** | ✅ Ingredient identity **independent of supplier** — no `supplier_id` on ingredients; many-to-many later in Purchasing |
| **RC-12** | ✅ Ingredient fields: name_ar, name_en (optional), code (optional), base UoM, active, standard cost — no purchase screens in RCA |
| **RC-13** | ✅ Recipes reference **IDs only** (menu_item_id, ingredient_id, uom_id) — never names as keys |
| **RC-14** | ✅ **Coverage Dashboard** (counts + % with/without recipe) |
| **RC-15** | ✅ **Professional cost breakdown** (per-line + totals + waste + yield + unit cost + sell + margin + margin %) |
| **RC-16** | ✅ Cost engine only — stock/purchase/supplier/AI/promo out of scope |
| **Implement** | ✅ **RCA only**; RCB deferred |

### Locked principles (RC-1 … RC-16)

| ID | Principle |
| -- | --------- |
| **RC-1** | Backbone for later Inventory deduct |
| **RC-2** | Server-computed cost only |
| **RC-3** | Cost mode always labeled (`standard` in RCA) |
| **RC-4** | Menu `base_price` is sell-price SSOT |
| **RC-5** | Theoretical ≠ ledger COGS |
| **RC-6** | UoM conversion required or hard fail |
| **RC-7** | Waste & yield numeric |
| **RC-8** | Purchasing-ready ingredient identity (no supplier FK) |
| **RC-9** | Promo/CRM safe |
| **RC-10** | No POS path change in RCA |
| **RC-11** | Ingredient ≠ supplier; no supplier_id on ingredients |
| **RC-12** | Ingredient master fields as approved |
| **RC-13** | ID-only recipe links |
| **RC-14** | Coverage dashboard |
| **RC-15** | Full cost breakdown |
| **RC-16** | Cost engine only in this capability |

---

## 1. Objective

Server-computed product cost model: components, cost, waste, yield, cost per sold unit, margin — Arabic admin UI; math in SQL RPCs only.

---

## 2. Scope

### In scope (RCA)

Ingredients (+ cost change log) · UoM + conversions · Recipes (menu-linked + prep) · yield/waste · cost breakdown RPCs · coverage dashboard · admin UI · permissions · audit · `pnpm test:recipes`

### Out of scope (RC-16 + Plan)

Inventory deduct · purchasing · suppliers · AI · promotions · M8 edits · modifier recipes (RCB) · inventory posting of prep

---

## 3. Cost formula (RCA)

```text
line_qty_in_base = convert(line.qty, line.uom → ingredient.base_uom)
line_cost        = line_qty_in_base × ingredient.standard_cost
ingredients_cost = Σ line_cost
total_batch_cost = ingredients_cost × (1 + waste_pct/100)
cost_per_yield_unit = total_batch_cost / yield_qty   -- yield_qty > 0
```

For menu-linked recipes: **1 sold unit = 1 yield unit** in RCA (portion mapping).  
`margin = sell_price − cost_per_yield_unit` · `margin_pct = margin / sell_price × 100` (null if price ≤ 0).

---

## 4. Slices

| Slice | Status |
| ----- | ------ |
| **RCA** | ✅ Approved to Implement |
| **RCB** | Modifier recipes — only if needed after RCA review |

---

## 5. Status

| Item | State |
| ---- | ----- |
| Plan | ✅ Approved |
| **RCA** | ✅ **Approved (2026-07-12)** — [recipes-costing-final-review.md](./recipes-costing-final-review.md) · **Recipes Feature Freeze** |
| RCB | ⏸ Deferred |
| Next | Inventory Capability Plan (product owner kickoff) |

---

## 6. Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| 0.1 | 2026-07-12 | Draft |
| **1.0** | **2026-07-12** | **Approved** — Q-RC1…8 + RC-11…16 · RCA Implement |
