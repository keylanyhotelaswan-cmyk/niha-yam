# Deployment Workflow (Testing → Production)

**Official policy:** [ADR-0036](./adr/0036-testing-first-deployment-workflow.md) · read-only Production tests: [ADR-0035](./adr/0035-production-readonly-tests.md)  
**Env setup:** [testing-environment.md](./testing-environment.md) · **Status:** [PROJECT_STATUS.md](../PROJECT_STATUS.md)

## Environments

| | Testing | Production |
| --- | --- | --- |
| **Role** | التطوير والاختبار **فقط** | التشغيل الفعلي **فقط** |
| **Supabase** | `xywgmolpnhimivwmsmpw` | `nzwgoavyrshuypkugvzc` |
| **App** | `pnpm dev:testing` → http://127.0.0.1:5174 | https://niha-yam.vercel.app (Vercel ← `main`) |
| **Features / migrations / اختبارات وظيفية ومالية** | ✅ هنا | ❌ ليس للاختبار |
| **Orders / Payments / Reopen / Reversal بغرض الاختبار** | ✅ | ❌ ممنوع |
| **Smoke مالي** | ✅ | ❌ ممنوع |
| **Health Check (قراءة)** | اختياري | ✅ بعد كل Release |

## قواعد ثابتة

1. **Testing** هي بيئة التطوير والاختبار الوحيدة لكل Feature و Migration واختبار وظيفي/مالي.
2. **Production ليست بيئة اختبار.** لا Smoke مالي، ولا إنشاء معاملات مالية تجريبية على قاعدة الإنتاج.
3. أي Feature تعتمد على Migration جديدة **لا تُعتبر جاهزة على Production** قبل اكتمال تلك الـ Migration على Production.
4. لا تُطبَّق Migrations على Production ولا يُعلن Release إلا **بعد موافقة صريحة** من المالك على نتيجة Testing.

## مسار العمل اليومي (Development)

```text
كود + supabase/migrations/*
        ↓
pnpm migrate:testing          ← Testing فقط
        ↓
pnpm dev:testing + اختبارات وظيفية/مالية على Testing
        ↓
Commit (لا تُعلن Production Ready قبل بوابة الإصدار)
```

| افعل | لا تفعل |
| --- | --- |
| `pnpm migrate:testing` | `pnpm migrate:production` بدون موافقة |
| اختبارات مالية على Testing | أي كتابة مالية على Production |
| Health / قراءة فقط على Production عند الحاجة | `NIHA_ALLOW_PROD_MUTATION=1` إلا بأمر مالك صريح منفصل |

> **تحذير Vercel:** الدفع إلى `main` ينشر واجهة Production تلقائيًا. لا تُدخل UI يعتمد على RPCs جديدة إلى `main` قبل بوابة الإصدار، أو نفّذ ترحيل Production في نفس نافذة الموافقة قبل إعلان الجاهزية.

## بوابة الإصدار (Release Gate) — بعد موافقة Testing

الترتيب **إلزامي**:

```text
1) موافقة المالك على Testing
2) NIHA_RELEASE_MIGRATE=1 pnpm migrate:production
   (أو NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema لمزامنة الاثنين مع المستودع)
3) تأكيد نشر التطبيق على Production (Vercel / main)
4) Health Check فقط — بلا معاملات مالية تجريبية
5) تقرير Release (القالب أدناه)
```

### Health Check المسموح على Production

- نجاح الـ Deployment (الواجهة تفتح، لا خطأ بناء ظاهر).
- نجاح الـ Migrations (قائمة الإصدارات على Production تطابق المستودع حتى آخر migration المعتمدة).
- عدم وجود أخطاء حرجة في Logs (Vercel / Supabase) ذات صلة بالإصدار.
- تشغيل طبيعي للقراءة/الدخول — **بدون** إنشاء طلبات أو مدفوعات أو Reopen أو Reversal للاختبار.

## تقرير بعد كل Release (إلزامي)

انسخ واملأ:

```markdown
# Release Report — YYYY-MM-DD

## Application
- **Commit Hash:** `<sha>`
- **Production URL:** https://niha-yam.vercel.app
- **Deploy:** ✅ / ❌ (Vercel Production)

## Database (Production)
- **Project:** nzwgoavyrshuypkugvzc
- **Migrations applied this release:**
  - `YYYYMMDDHHMMSS_name`
- **Production migration head matches repo:** ✅ / ❌

## Sync confirmation
- **Testing schema head:** `<version>`
- **Production schema head:** `<version>`
- **Testing ↔ Production schema sync:** ✅ / ❌
- **Application version (commit) on Production:** `<sha>` — ✅ / ❌

## Health Check (Production — read-only)
- Deployment OK: ✅ / ❌
- Migrations OK: ✅ / ❌
- Critical logs: none / notes
- App loads normally: ✅ / ❌

## Explicit non-actions
- No financial smoke on Production: ✅
- No test orders/payments/reopen/reversal on Production: ✅

## Notes
- …
```

## أوامر

| الأمر | متى |
| --- | --- |
| `pnpm migrate:testing` | أثناء التطوير بعد كل migration جديدة |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:production` | بعد موافقة المالك فقط |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema` | مزامنة Production + Testing مع المستودع عند الإصدار |
| `pnpm seed:testing` | Testing فقط — أبدًا على Production |

التحقق من سلامة سكربتات الاختبار: `pnpm verify:script-safety` (ADR-0035).
