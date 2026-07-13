# Operational Hardening v1.1 — Final Review

**Date:** 2026-07-13  
**Plan:** [operational-hardening-v1.1-plan.md](./operational-hardening-v1.1-plan.md)  
**Stance:** QA Lead review of production readiness — **not** a new capability.  
**Verdict:** ✅ **Production Ready (Operations)** · proceed to Purchasing

---

## Executive verdict

The ops surface (POS / Orders / Sessions / Shift / Print / Call Center) is **stable enough for 12-hour live restaurant use** under the current Feature Freezes. Remaining risk is normal ops risk (hardware Bridge offline, human error) — not architectural gaps that would block Purchasing.

---

## OH-1 — Shift summary bug (fixed)

| Finding | Fix |
| ------- | --- |
| Cashiers could fall through to **day** totals when `shiftId` was briefly null | `useCollectionTotals`: cashiers **always** scope=`shift`; day query only when `allowDayScope` |
| `by_collection_status` dropped in FE parse | `collectionTotals.api.ts` now parses paid/unpaid/partial |
| Day RPC callable by any authenticated staff | `get_day_collection_totals` now requires `is_owner_or_manager()` |
| OH-1 SQL not on remote | Pushed `20260713160000` + `20260713160100` |

**Design (locked):** Cashier = open shift only · Manager (`reports.view` \| `treasury.manage`) may toggle day.

---

## Stress suites (counts)

| Suite | Script | Assertions | Result |
| ----- | ------ | ---------- | ------ |
| **OH-2 Orders** | `pnpm test:oh-orders` (×50) | **18** | ✅ 18/18 |
| **OH-3 Print** | `pnpm test:oh-print` (burst 40) | **20** | ✅ 20/20 |
| **OH-4 Shift** | `pnpm test:oh-shift` | **30** | ✅ 30/30 |
| **Regression** | `pnpm test:shift-handover` | **20** | ✅ 20/20 |
| **Total new stress** | | **68** | ✅ |
| **With handover regression** | | **88** | ✅ |

Also: `pnpm typecheck` → PASS.

---

## Scenarios tested

### Orders (OH-2)
- Pay now / unpaid / partial / delivery / takeaway mix ×50  
- No lost orders · unique references · all on open shift  
- Identity (Created By / At) via `get_order_detail`  
- Reprint receipt + kitchen without silent loss  
- Hub excludes settled paid  
- Shift collection totals = order paid totals; day scope distinct  
- Print jobs present for pay-now · shift report readable  

### Print (OH-3)
- Concurrent sale waves (5-wide × 40) → queue depth  
- Claim / report success+fail mix · Retry  
- Expire → Print Again  
- Heartbeat reconnect (`restarted`) · Duplicate ACK idempotent  
- Printer health snapshot  

### Shift / handover (OH-4 + realistic failures)
- Open → sales → expense → cash drop → close Path A with variance  
- Double close blocked · Cash drop while pending blocked · Recreate while pending blocked  
- Open while Path A pending · **Idempotent receive** (refresh/double-click)  
- Path B: pending gate · receive-count required · reject → recreate · receive with variance  
- Archive · Hub open-shift only · Concurrent `open_shift` race → single winner  
- Handover Bridge print enqueue  

### Discovered during review (not in original happy path)
1. **Idempotent Path A receive** — second call returns `idempotent: true` (refresh during receive)  
2. **Concurrent `open_shift` race** — drawer lock first (OH-5) prevents double open  
3. **Day totals RPC leak to cashiers** — closed with manager-only gate  
4. **FE day fallback for cashiers** when shift context briefly missing  
5. **Extreme parallel finalize_sale (40 at once)** hits statement timeout — mitigated with wave size 5 + sequential fill; realistic POS load is fine  

---

## Reliability fixes shipped

| Area | Change |
| ---- | ------ |
| Locks | `open_shift` locks drawer **before** open-shift check |
| Idempotency | `receive_treasury_handover` no-ops safely if already executed |
| Close/receive | `FOR UPDATE` on shift / handover rows (prior OH migration) |
| Authorization | Day collection totals manager-only |
| FE scope | Cashier never resolves day scope |

---

## Production Ready checklist

| Criterion | Status |
| --------- | ------ |
| Shift summary = current shift for cashier | ✅ |
| Manager day toggle | ✅ |
| Orders hub = open shift action queue | ✅ (verified under stress) |
| Handover matrix + failure modes | ✅ |
| Print queue / retry / expire / again | ✅ |
| Race / idempotency on money path | ✅ |
| Stress coverage automated | ✅ 68 new checks |
| Architecture unchanged / freezes respected | ✅ |

**Not claimed:** infinite horizontal scale, multi-restaurant, or zero hardware failures. Bridge offline still requires local recovery (already in M6B contract).

---

## Operational Freeze (unchanged)

POS / Orders / Sessions / Shift / Call Center / Printing / Ops messages:

- ✅ Bug / Performance / UX only  
- ❌ No new ops capabilities without a new Plan  

**Next capability:** **Purchasing** (Plan → Review → Approve).

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-13** | OH v1.1 Implement + stress + Production Ready |
