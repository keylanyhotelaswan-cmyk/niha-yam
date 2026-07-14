# Operational Stabilization Sprint — Final Review

**Date:** 2026-07-14  
**Scope:** Bug fixes only — no new features, no design redesign, no freeze breaks.  
**Areas:** Ops Feedback · Treasury transfers (cashier + manager)

---

## 1. ملاحظات التشغيل (Ops Feedback)

### Repro
1. كاشير → أدوات التشغيل → ملاحظات التشغيل → إرسال عدة ملاحظات متتالية، أو
2. مدير → `/admin/ops-feedback` عند فشل RPC فيظهر «لا توجد ملاحظات بعد» رغم الخطأ.

### Root Cause
1. `financial_ref_table_max` / `financial_ref_exists` لم يعرفا `ops_feedback` → كانا يسقطان في فرع `treasury_transfers`؛ مراجع `NT-*` غير متزامنة مع الجدول → احتمال UNIQUE violation عند الإدراج.
2. واجهة الإدارة تعاملت `isError` كقائمة فارغة.
3. سياسات Storage على bucket `ops-feedback` بلا تقييد مطعم (أي authenticated يقرأ/يرفع أي ملف).
4. `submit_ops_feedback` يكتب `ops_feedback.created` / `ops_feedback.status` في `audit_log` لكن `chk_audit_log_m1_actions` لم يسمح بهما → فشل الإرسال بـ CHECK violation.

### Fix
- Migration `20260714170000_ops_stab_feedback_transfer.sql`: تسجيل `ops_feedback` في financial_ref + مزامنة العداد + تقييد Storage بالمجلد `{restaurant_id}/…`.
- Migration `20260714171000_ops_feedback_audit_actions.sql`: إضافة `ops_feedback.created` و`ops_feedback.status` لقائمة audit المسموحة.
- رفع الصور يصير تحت مسار المطعم.
- `OpsFeedbackAdminPage`: عرض خطأ + إعادة محاولة بدل empty مضلّل.

### Regression
- `pnpm test:ops-stab` — **9/9 passed** (إرسال ملاحظتين بـ `NT-` فريدتين + نجاح list admin + سيناريوهات التحويل).

---

## 2. التحويل بين الخزن

### Flow (مقصود — بلا تغيير تصميم)
| مسار | السلوك |
|------|--------|
| كاشير `تحويل بين الخزن` | `pos_operational_transfer` → **executed فورًا** (درج ↔ رقمية فقط، وردية مفتوحة) |
| مدير تبويب التحويلات | `create_transfer` → **pending** → `approve_transfer` / `reject_transfer` |

### Root Cause (Bugs)
1. `reject_transfer` بدون `FOR UPDATE` / بدون `WHERE status='pending'` → سباق مع الاعتماد يمكنه وضع `rejected` على تحويل منفَّذ والحركات باقية.
2. `reverse_transfer` غير مقفول بنفس أسلوب chaos.
3. `pos_operational_transfer` بلا قفل خزائن وبلا `assert_cash_ops_allowed` (سكتات رصيد متزامنة + remote).

### Fix
- نفس الـ migration: تأمين `reject_transfer` و`reverse_transfer` و`pos_operational_transfer` (أقفال + CAS + بوابة نقدية).

### Regression
- `pnpm test:ops-stab` — create pending → concurrent approve∥reject (فائز واحد) → رفض بعد execute = `INVALID_STATE` → حركتان عند execution / صفر عند reject.

### ما لم يُغيَّر (ليس Bug)
- الإرسال الفوري من POS يبقى كما في M5 (عمليات تشغيلية مقيّدة)، وليس مسار F1 للمدير.

---

## Acceptance
- [x] Root Cause موثّق لكل مشكلة
- [x] Bug Fix (migrations `…170000` + `…171000`)
- [x] Regression script `test:ops-stab` — 9/9
- [x] لا Features جديدة / لا redesign
- [x] Migrations مطبَّقة على Supabase المرتبط
