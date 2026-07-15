# NIHA ERP — Project Status

**Last updated:** 2026-07-15  
**App baseline:** 1.1.0 · Operational release `v1.1.0-production`  
**This file is the official at-a-glance project status.** Detailed module history lives in [`docs/modules.md`](./docs/modules.md).

---

## المرحلة الأولى — مكتملة ومجمدة

تعتبر المرحلة الأولى من التشغيل (Operational Phase 1) **مكتملة** و**مجمّدة (Feature Freeze)**.

### ما يشمله التجميد

| المجال | الحالة |
| --- | --- |
| نقطة البيع (POS) | ✅ مكتمل · مجمّد |
| الطلبات (Orders) | ✅ مكتمل · مجمّد |
| الطباعة (Printing + Bridge + Designer) | ✅ مكتمل · مجمّد |
| الورديات (Shifts + Shift Handover) | ✅ مكتمل · مجمّد |
| الخزنة (Treasury) | ✅ مكتمل · مجمّد |
| التقارير (Reports) | ✅ مكتمل · مجمّد |
| الصلاحيات (Permissions — الدور الحالي) | ✅ مكتمل · مجمّد |
| ملاحظات التشغيل (Ops Feedback) | ✅ مكتمل · مجمّد |
| بيئة Testing | ✅ جاهزة · تُحافظ عليها |

يشمل التجميد أيضًا ما اعتُمد معه في خط التشغيل: القائمة، الموظفين، الوصفات (RCA)، المخزون (INVA)، والتقارير — انظر التفاصيل في الوثائق.

### قواعد التعديل على المرحلة الأولى

أي عمل مستقبلي على هذه المجالات **مسموح فقط** إذا كان واحدًا من:

1. **إصلاح Bug**
2. **تحسين سرعة (Performance)**
3. **تحسين بسيط في واجهة المستخدم (UX)**

**ممنوع** إضافة Features جديدة إلى مجالات المرحلة الأولى المجمّدة.

---

## المرحلة الحالية

```
Current Phase: Suppliers & Purchasing
```

هذا هو **المرجع الرسمي** لاتجاه المشروع الآن.

| البند | الحالة |
| --- | --- |
| Capability | Suppliers & Purchasing |
| Vision | [docs/niha-erp-vision-2.0.md](./docs/niha-erp-vision-2.0.md) ✅ |
| Plan | [docs/suppliers-purchasing-plan.md](./docs/suppliers-purchasing-plan.md) — ✅ **Approved 1.0** (2026-07-15) · Q-PUR1…Q-PUR8 مقفلة |
| Implement | ⏸ **بانتظار kickoff صريح لـ PURA على Testing** — لا كود حتى ذلك الحين |

---

## كيف تُقرأ هذه الحالة

| السؤال | الجواب |
| --- | --- |
| أين نقف؟ | المرحلة الأولى مجمّدة · ننتقل لـ Suppliers & Purchasing |
| هل نلمس POS/طباعة/خزنة بميزات جديدة؟ | لا — Freeze |
| أين التفاصيل التاريخية؟ | [`docs/modules.md`](./docs/modules.md) وملفات Final Review في `docs/` |
| أين تختبر؟ | مشروع Suppliers يُطوَّر ويُختبر على بيئة Testing المنفصلة — [`docs/testing-environment.md`](./docs/testing-environment.md) |

---

## ملخص قصير

> **Phase 1 = Done + Frozen.**  
> **Current Phase = Suppliers & Purchasing.**  
> Plan = Approved · Implement = بانتظار kickoff PURA على Testing أولًا.
