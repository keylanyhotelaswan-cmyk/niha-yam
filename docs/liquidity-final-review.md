# Liquidity Management — Final Review (Testing)

**Date:** 2026-07-16  
**Environment:** Testing ✅ · **Production ✅** (promoted 2026-07-16)  
**Verdict:** ✅ **LIVE on Production** · **Liquidity Feature Freeze** (bug/perf/UX only)

---

## What shipped

Administrative split of **Main cash** into:

- **رصيد التشغيل** (operating)
- **الرصيد المحفوظ** (reserved)

| Rule | Implementation |
| ---- | -------------- |
| No new treasury | Virtual buckets via `liquidity_allocations` |
| No accounting change | Ledger / `treasury_balance` unchanged on release |
| Not profits | Copy + audit state clearly |
| Revenue feed | Auto-split on Main `transfer_in` from handover / cash drop |
| Spend gate | Expense (Main) · cash purchase · supplier payment → `INSUFFICIENT_OPERATING_FUNDS` |
| Release | `liq_release_reserved(amount, reason)` with audit |

### RPCs

`liq_get_snapshot` · `liq_upsert_settings` · `liq_release_reserved` · `liq_list_allocations`

### UI

Treasury → Overview → **إدارة السيولة** panel (ratios + release).

---

## Tests (Testing)

| Suite | Result |
| ----- | ------ |
| `pnpm test:liquidity` | ✅ **20 / 20** |
| `pnpm test:pura` | ✅ 23/23 |
| `pnpm test:purb` | ✅ 36/36 |
| `pnpm typecheck` | ✅ |

---

## Design decisions

1. **Split source = cash landing in Main** (handover receive / cash drop), not drawer pending collections — matches V-A14 drawer holds cash until handover.  
2. **Operating = Main balance − reserved** (capped). Release does not post treasury movements.  
3. **Drawer expenses** still use operational drawer balance (not Main operating gate).

---

## Production promote (2026-07-16)

| Step | Result |
| ---- | ------ |
| Migrations | ✅ `…190000` … `…193000` (liquidity + polish) |
| Deploy | ✅ https://niha-yam.vercel.app |
| Testing smoke | ✅ `smoke:liq-handover-testing` **14/14** |
| Production smoke | ✅ `smoke:liq-handover-production` **10/10** |

### Feature Freeze

Bug / perf / UX only. No new vaults, no partner/profit accounting, no PURC.

**PURC remains blocked.**
