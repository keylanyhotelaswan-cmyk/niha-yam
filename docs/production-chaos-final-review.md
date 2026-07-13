# Production Chaos & Simulation Suite — Final Review

**Date:** 2026-07-13  
**Plan:** [production-chaos-suite-plan.md](./production-chaos-suite-plan.md)  
**Stance:** Adversarial QA (try to break the system) — **not** a new capability.  
**Verdict:** ✅ **Production Ready (Operations)** — proceed to Purchasing

---

## Executive verdict

After deliberate chaos (double-submit, concurrent money paths, dual-user Call Center, Bridge restart, security probes) and a **200-op random fuzz** with consistency checks, the operational DB remained coherent: no lost orders, no half-complete Path A handovers, ≤1 open shift, valid payment statuses, F1 movements intact.

Remaining risks are **operational/environmental** (true multi-hour soak, browser offline mid-click, Bridge hardware), not blocking architectural defects.

---

## Suites run

| Suite | Command | Result |
| ----- | ------- | ------ |
| **PC-1 Chaos** | `pnpm test:chaos` | **48/48 PASS** |
| **PC-2 Fuzz** | `pnpm test:chaos-fuzz -- --ops 200 --seed 42` | **18/18 PASS** · 86 orders · 8 shift rotations · 1 tolerated error · ~343s |
| **Regression** | prior OH + handover suites | still green from Hardening |

---

## Scenarios tested (mapped)

### POS
- Same action ×10 · duplicate `client_request_id` · concurrent same request id  
- Concurrent edit same order · reprint unpaid · concurrent collect  

### Shift
- Double close · triple receive (idempotent) · reject Path B then invalid receive id · open after reject  

### Treasury
- Concurrent cash_drop · concurrent expenses · approve∥reject expense (exactly one wins)  

### Printing
- Pair · claim · duplicate ACK · heartbeat restarted · printer rename · expire · print again · old Bridge version string  

### Call Center / Security
- Remote Operator create unpaid · cash_drop / finalize blocked (`REMOTE_OPERATOR_NO_CASH`)  
- Dual edit remote∥owner · anon RPC denied · manager day totals  

### Fuzz / Long-run (compressed)
- 200 random ops: sale / unpaid / collect / edit / expense / drop / reprint / approve / shift rotate / double collect  
- End invariants: payment_status · shift_id · unique refs · handovers · print queue · single open shift · ledger treasuries  

### Not fully simulable at RPC layer (documented residual)
- Browser close mid-payment UI · OS power loss · true 12h wall-clock · physical printer off · multi-tab React state  

---

## Bugs found & fixed (this sprint)

| Bug | Severity | Fix |
| --- | -------- | --- |
| `reject_collection` / `reject_expense` without row lock → approve then reject could corrupt status | **High** | `FOR UPDATE` + `WHERE status/collection_status = pending` + row count |
| `cash_drop` concurrent overdraft race | **Med** | Lock drawer + safe treasuries before balance check |
| `approve_transfer` double-approve race | **Med** | `FOR UPDATE` + pending-only update + treasury locks |
| Remote Operator could call `cash_drop` / `pos_record_expense` (trigger only on payments) | **Med** | `assert_cash_ops_allowed()` at RPC entry |
| `approve_collection` vs `edit_pending_order` TOCTOU | **High** | Lock parent order before posting ledger |

Migration: `20260713170000_chaos_reliability_locks.sql` (pushed).

---

## Bugs / findings not requiring code change

| Finding | Notes |
| ------- | ----- |
| Concurrent same `client_request_id` may return Postgres unique-constraint text instead of `DUPLICATE_REQUEST` | **Data-safe** (≤1 order). Residual UX polish only. |
| Double-click without `client_request_id` creates multiple orders | **By design** — FE should send request ids (already supported). |
| Claimed print jobs can linger if Bridge claims and never ACKs | Expected without live Bridge; expire/retry paths covered. |
| Fuzz ~1 soft error / 200 ops | Within tolerance (insufficient funds / state races handled). |

---

## Remaining risks (accept for Purchasing)

1. **True 12-hour soak** not run in this session — use `pnpm test:chaos-fuzz -- --ops 1000` overnight before go-live if desired.  
2. **Client UX races** (Back / Refresh mid-dialog) rely on RPC locks + `client_request_id` — ensure POS always sends request ids on pay-now.  
3. **Bridge hardware** offline still requires local recovery (M6B contract unchanged).  
4. **PIN / lock screen** multi-user switch covered earlier (OC); not re-probed as browser UI here.

---

## Production Ready checklist

| Criterion | Status |
| --------- | ------ |
| Chaos suite green | ✅ 48/48 |
| Fuzz + consistency green | ✅ 18/18 |
| High/Med race fixes shipped | ✅ |
| No architecture / feature creep | ✅ |
| Operational Freeze intact | ✅ |

**Final judgment: Production Ready (Operations).**  
**Next:** Purchasing Plan kickoff.

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-13** | Chaos + Fuzz + reliability locks · Production Ready |
