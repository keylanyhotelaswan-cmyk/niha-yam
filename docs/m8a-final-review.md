# M8A — Final Review Report

**Slice:** M8A — S0 ملخص اليوم + S1–S4 (Shift · Official sales · Treasury · Expenses)  
**Date:** 2026-07-12  
**Plan:** [m8-reports-plan.md](./m8-reports-plan.md) ✅ Approved  
**Verdict:** ✅ **M8A APPROVED** (2026-07-12) — superseded for module close by [m8-final-review.md](./m8-final-review.md) (M8A+M8B)

---

## 1. Automated results

| Check | Result |
| ----- | ------ |
| `pnpm test:m8` | **16 / 16 PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm build` | **PASS** |

### `test:m8` coverage

- Official sales shape + mode  
- **RANGE_TOO_LARGE** for > 31 days  
- Expenses pending + executed fields  
- Today summary parity with official sales total  
- Pending fields separate from official  
- Shift list + `get_shift_report`  
- Treasury ledger official mode  

---

## 2. Delivered (M8A only)

| Item | Status |
| ---- | ------ |
| Migration RPCs `report_today_summary`, `report_official_sales`, `report_expenses`, `report_treasury_ledger`, `list_shifts_for_reports`, 31-day cap | ✅ |
| `reports.view` permission (owner/manager) | ✅ |
| Route `/admin/reports` + nav **التقارير** | ✅ |
| **S0 ملخص اليوم** landing (composed from same helpers) | ✅ |
| **S1** Shift report (closed/open via picker) | ✅ |
| **S2** Official sales + CSV | ✅ |
| **S3** Treasury balances + date-filtered ledger | ✅ |
| **S4** Expenses executed vs pending | ✅ |
| Browser print | ✅ |
| Dashboard thin link to Reports (no second math engine) | ✅ |
| Cashier denied Reports module (manager gate) | ✅ |
| Official vs operational mode badges | ✅ |
| Voided orders excluded from official sales | ✅ |

**Not in M8A (as planned):** S5–S8, PDF, report-view audit, charts.

---

## 3. Principles check

| Principle | Status |
| --------- | ------ |
| Read-only | ✅ |
| Compute from source (no summary tables) | ✅ |
| Official ≠ operational | ✅ |
| Money math in RPCs only | ✅ |
| M5/M6 feature freezes untouched | ✅ |

---

## 4. Sign-off

| Gate | Result |
| ---- | ------ |
| Scope = S0 + S1–S4 only | **PASS** |
| Suites / typecheck / build | **PASS** |
| **M8A Approved** | ✅ **2026-07-12** |
| **M8B** | ✅ Delivered + closed in [m8-final-review.md](./m8-final-review.md) |

**Next:** See M8 Final Review — module approved; Reports feature freeze; Operational V1.0.
