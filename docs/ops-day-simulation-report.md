# Ops-Day Simulation Report (Testing)

**Date:** 2026-07-15T15:12:07.432Z
**Environment:** Testing only
**Actor:** manager
**Checks:** 64 passed · 0 failed
**Verdict:** ✅ ALL SCENARIOS PASS — ready to consider Production promote

| السيناريو | النتيجة | التفاصيل |
| --- | --- | --- |
| فتح وردية | ✅ | 5/5 |
| المبيعات | ✅ | 10/10 |
| التحصيل | ✅ | 6/6 |
| الخصومات | ✅ | 3/3 |
| المصروفات | ✅ | 1/1 |
| التحويلات | ✅ | 5/5 |
| شراء البضاعة | ✅ | 13/13 |
| Reverse | ✅ | 4/4 |
| التقارير | ✅ | 9/9 |
| إغلاق الوردية | ✅ | 4/4 |
| اختبارات الضغط | ✅ | 3/3 |
| الطباعة | ✅ | 1/1 |

## Failures (if any)

None.

## Notes

- Simulation covers ~70+ interlocking POS/treasury/inventory/purchasing ops (sales ≈38, purchases, expenses, transfers, reverse, stress bursts).
- Bug found & fixed during run: `pur_list_ops_uoms` / `pur_list_ops_ingredients` were `STABLE` but called `rc_ensure_default_uoms` (INSERT) → `cannot execute INSERT in a read-only transaction`. Fixed via migration `20260715191200_fix_ops_list_readonly.sql` + volatile `pur_bootstrap_ops_uoms`. Applied to **Testing only**.
- No Production migrate/deploy performed.
- PURB not started.
- Do not promote ops UX / this fix to Production until you explicitly approve after this green simulation.
