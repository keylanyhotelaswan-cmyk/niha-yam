# M8 — Final Review Report

**Module:** M8 — Reports (M8A + M8B)  
**Date:** 2026-07-12  
**Plan:** [m8-reports-plan.md](./m8-reports-plan.md) ✅ Approved  
**ADR:** [ADR-0032](./adr/0032-reports-compute-from-source.md) ✅ Accepted  
**Verdict:** ✅ **M8 APPROVED** · **Reports Feature Freeze** · system treated as **Operational Version 1.0**

---

## 1. Automated results

| Check | Result |
| ----- | ------ |
| `pnpm test:m8` | **25 / 25 PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm build` | **PASS** |
| Migration `20260712110000_m8b_reports_rpcs.sql` | **Pushed** (linked) |

### `test:m8` coverage

**M8A (money):** official sales · RANGE_TOO_LARGE · expenses · today summary parity · shifts · treasury ledger · pending ≠ official  

**M8B (ops):** orders summary + voided separate · delivery by driver · item mix · print reliability · M8B range cap  

---

## 2. Delivered

### M8A (previously approved)

| Item | Status |
| ---- | ------ |
| S0 ملخص اليوم | ✅ |
| S1 Shift report | ✅ |
| S2 Official sales + CSV | ✅ |
| S3 Treasury balances + ledger | ✅ |
| S4 Expenses executed vs pending | ✅ |
| `reports.view` · `/admin/reports` · Dashboard thin link | ✅ |

### M8B (this close)

| Item | Status |
| ---- | ------ |
| **S5** Orders summary (active vs voided separate; refunded excluded from active) | ✅ |
| **S6** Delivery by driver + unassigned count | ✅ |
| **S7** Item / category mix (`line_total` incl. modifiers) | ✅ |
| **S8** Print reliability (jobs / success rate / by status · kind) | ✅ |
| Tabs + CSV on ops reports | ✅ |
| Same 31-day Cairo range helpers | ✅ |

**Explicitly out of M8 (frozen out):** PDF export · report-view audit · charts · cashier Reports access · new money/print product features.

---

## 3. Principles check

| Principle | Status |
| --------- | ------ |
| Read-only | ✅ |
| Compute from source (no summary tables) | ✅ |
| Official ≠ operational | ✅ |
| Money math in RPCs only | ✅ |
| Voided never in official sales | ✅ |
| M5/M6 feature freezes untouched | ✅ |

---

## 4. Sign-off

| Gate | Result |
| ---- | ------ |
| Scope = Plan S0–S8 | **PASS** |
| Suites / typecheck / build | **PASS** |
| **M8 Approved** | ✅ **2026-07-12** |
| **Reports Feature Freeze** | ✅ Starts now — bug / perf / UX only; no new report features without a new Plan cycle |
| **Operational Version 1.0** | ✅ Core loop (staff → menu → treasury → POS → print → reports) is ready for live operation |

---

## 5. After approval — operating posture

1. **Run the restaurant** on this stack as **Operational V1.0**.  
2. **Do not** start a new feature module from roadmap assumptions.  
3. **M7 KDS** stays deferred until paper workflow proves insufficient.  
4. After a period of real operation, **revisit the roadmap** and pick the next priority from **observed operational need**, not from a pre-written sequence.

**Next product work** requires a new Plan → Review → Approve cycle for whatever ops demand first.
