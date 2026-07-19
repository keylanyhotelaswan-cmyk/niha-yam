# NIHA ERP — Project Status

**Last updated:** 2026-07-19  
**App baseline:** 1.1.0 · Operational release `v1.1.0-production`  
**Print Bridge baseline:** **0.5.0** (dual-env reference) · approved package track **0.5.3+** · current **0.5.8** (portable printer ownership + updater PID wait + single-instance) · print architecture freeze: hotfixes only  
**This file is the official at-a-glance project status.** Detailed module history lives in [`docs/modules.md`](./docs/modules.md).

### الطباعة — Feature Freeze (مغلق)

نظام الطباعة (Print Center + Bridge **0.5.0** + Dual Connections + claim gate) **منتهٍ ومجمّد** في هذه المرحلة.

| مسموح | ممنوع |
| --- | --- |
| Hotfix لـ Bug حقيقي فقط · أقل تغيير ممكن | ميزات جديدة · Refactoring |
| Hotfix 0.5.8: ملكية الطابعة تتبع الجهاز عند Pair / sole-thermal | تغيير تصميم Bridge / Dual Connections |
| | تعديل `claim_print_jobs` أو Bridge إلا لإصلاح عطل مؤكد |

**تشغيل:** نقل الطابعة لجهاز جديد = Pair مرة واحدة (الملكية تنتقل تلقائيًا). اختبار Testing = إضافة بيئة ثانية + تفعيل الطباعة — بدون مسح الإنتاج.

التفاصيل: [`docs/print-dual-env-testing.md`](./docs/print-dual-env-testing.md).

### سياسة الاختبارات (ثابتة) — ADR-0035

سكربتات **`smoke` / `test` / `simulation` / `fuzz` / `chaos`**:

| البيئة | المسموح |
| --- | --- |
| **Production** | قراءة / تشخيص / Health فقط — **ممنوع** أي تغيير بيانات |
| **Testing** | اختبارات تغيّر البيانات |

الاستثناء الوحيد: أمر صريح من المالك مع `NIHA_ALLOW_PROD_MUTATION=1`.  
التفاصيل: [`docs/adr/0035-production-readonly-tests.md`](./docs/adr/0035-production-readonly-tests.md) · التحقق: `pnpm verify:script-safety`.

---

## المرحلة الأولى — مكتملة ومجمدة

تعتبر المرحلة الأولى من التشغيل (Operational Phase 1) **مكتملة** و**مجمّدة (Feature Freeze)**.

### ما يشمله التجميد

| المجال | الحالة |
| --- | --- |
| نقطة البيع (POS) | ✅ مكتمل · مجمّد |
| الطلبات (Orders) | ✅ مكتمل · مجمّد |
| الطباعة (Printing + Bridge + Designer) | ✅ مكتمل · **Feature Freeze مغلق** · Bridge **0.5.0** · Hotfix فقط |
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
| Plan | [docs/suppliers-purchasing-plan.md](./docs/suppliers-purchasing-plan.md) — ✅ **Approved 1.0** · Q-PUR مقفلة |
| PURA | ✅ **Production** (2026-07-15) · migrate + deploy + smoke · [Final Review](./docs/purchasing-final-review-pura.md) |
| Ops UX | ✅ **Production Ready** — Dialog «حركة مالية جديدة» + `can_operational_purchase` · migrate + deploy + smoke 9/9 · [ops-day sim](./docs/ops-day-simulation-report.md) |
| PURB | ✅ **Production** (2026-07-16) · migrate + deploy + smoke 23/23 · **Feature Freeze** · [Final Review](./docs/purchasing-final-review-purb.md) |
| Liquidity | ✅ **Production + Feature Freeze** (2026-07-16) · [Final Review](./docs/liquidity-final-review.md) |
| Smart Handover Sheet | ✅ **Production + Feature Freeze** (2026-07-16) · [Final Review](./docs/smart-shift-handover-final-review.md) |
| PURC | ▶️ **التالي** — Aging / dues + statement polish + cost feed · كان محجوبًا حتى السيولة + استلام الوردية (اكتملتا) · بانتظار kickoff صريح |

---

## كيف تُقرأ هذه الحالة

| السؤال | الجواب |
| --- | --- |
| أين نقف؟ | الطباعة مجمّدة · التالي = **PURC** (بعد kickoff) |
| هل نلمس الطباعة بميزات جديدة؟ | لا — Feature Freeze · Hotfix فقط |
| هل نلمس POS/خزنة بميزات جديدة؟ | لا — Freeze |
| أين التفاصيل التاريخية؟ | [`docs/modules.md`](./docs/modules.md) وملفات Final Review في `docs/` |
| أين تختبر؟ | Testing أولًا — [`docs/testing-environment.md`](./docs/testing-environment.md) |

---

## ملخص قصير

> **Phase 1 = Done + Frozen.**  
> **Printing = Feature Freeze مغلق** (Bridge 0.5.0 · Hotfix فقط).  
> **PURA/PURB ✅ Production + Freeze**.  
> **Liquidity ✅ Production + Freeze** · **Smart Handover Sheet ✅ Production + Freeze**.  
> **Next = PURC** (بانتظار kickoff).
