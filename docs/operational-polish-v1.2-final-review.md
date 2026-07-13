# Operational Polish v1.2 — Final Production Review

**Date:** 2026-07-13  
**Scope:** Last operational completion before Purchasing — Feedback Center + cashier Arabic UX.  
**Verdict:** ✅ **Production Ready** · **Operational Freeze (final)**

---

## What shipped

### 1. مركز ملاحظات التشغيل
- Cashier: **ملاحظات التشغيل** from أدوات التشغيل (title, body, kind, priority, optional photo).
- Auto-captures: cashier, shift, device, app version, Bridge version (when known), timestamp.
- Auto-links: order (when detail open) · shift · pending handover.
- Admin: `/admin/ops-feedback` — search, status filters, comments, resolution + «تم الحل في الإصدار».
- Migration: `20260713180000_ops_feedback_center.sql` · storage bucket `ops-feedback`.

### 2. مصطلحات الكاشير (Arabic-only sweep)
| Before | After |
| ------ | ----- |
| Cash Drop / Opening Float / Variance | تحويل نقدي للخزنة / الرصيد الافتتاحي / فرق العدّ |
| Pending / معلّق (money) | بانتظار الاعتماد / بانتظار الاستلام |
| Bridge / Heartbeat / Queue / Retry | برنامج الطباعة / آخر اتصال / قائمة الطباعة / إعادة المحاولة |
| Print Again / Online / Failed / Success | طباعة مرة أخرى / متصل / فشل / تم بنجاح |
| PIN / Walk-in / SKU | رمز الدخول / عميل عابر / المنتج |

### 3. UX / cycle
- Feedback entry always available (even without shift) so notes are never blocked.
- Context link follows open order / shift / handover.
- App version → **0.1.1**.

### 4. Printing copy
- Admin Print Center strings rewritten for managers in plain Arabic (no Bridge/Queue/spooler jargon in primary labels).

### 5. Performance
- No architecture change; existing realtime + 30s refetch retained. Feedback uses same realtime invalidation channel.

---

## Residual risks (acceptable)

1. Photo upload requires storage policies live (bucket created in migration).
2. Some advanced Print Center tooltips may still mention technical details for IT — primary cashier surfaces are Arabic.
3. True overnight soak remains optional (`test:chaos-fuzz --ops 1000`).

---

## Operational Freeze (final)

**POS / Orders / Sessions / Shift / Treasury ops / Printing / Call Center / Ops Messages / Ops Feedback:**

- ✅ Bug / Performance / simple UX only  
- ❌ No new ops capabilities without a new Plan  

**Next capability:** **Suppliers & Purchasing** (Plan → Review → Approve).

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-13** | Feedback Center + terminology + Freeze |
