# Print Fields Completeness — Final Review

**Date:** 2026-07-13  
**Plan:** [print-fields-completeness-plan.md](./print-fields-completeness-plan.md) ✅ Approved  
**Verdict:** ✅ **Print Designer content complete** · Printing freeze resumes (bug / perf / UX only)

---

## What shipped

### WYSIWYG (mandatory)
- `m6_build_order_print_payload` restores **`layout`**, slogan, restaurant phone/address, currency, payment status/method.
- Preview and live paper share the same snapshot + layout bake.

### Designer fields (optional toggles + Arabic labels)
| Group | Fields |
| ----- | ------ |
| المطعم | اسم · شعار · عنوان · هاتف |
| الطلب / المسؤولية | فاتورة · طلب · نوع · أنشأ الطلب · آخر تعديل · تم التحصيل بواسطة · أوقات الإنشاء/التعديل/التحصيل/الطباعة |
| العميل | اسم · هاتف · منطقة · عنوان · ملاحظات توصيل · مندوب · طاولة |
| الدفع | وسائل الدفع المفصّلة · حالة · باقي |
| التشغيل | وردية · فرع · جهاز (إن توفر) |
| المطبخ | هاتف · منطقة · عنوان (مخفي افتراضيًا) · مندوب إن وُجد · أنشأ الطلب · وقت الإنشاء |

### UX
- مجموعات حقول في المصمم (عناوين مجموعات).
- لا كلمة «كاشير» — «أنشأ الطلب».
- العهدة / الرسائل التشغيلية: ثابتة كما هي (خارج المصمم).

### Bridge
- `LayoutSnapshotRender` يقرأ الحقول الجديدة (v**0.3.14**). يلزم إعادة نشر Bridge للورق الحي.

### Migration
- `20260713190000_print_fields_completeness.sql`

---

## Freeze

بعد هذه الشريحة: **منطقة الطباعة مغلقة** إلا bug / performance / UX بسيط.

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-13** | Completeness Implement + Final Review |
