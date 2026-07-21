# بيئة الاختبار (Testing Environment)

**الهدف:** تشغيل NIHA على مشروع Supabase منفصل تمامًا عن الإنتاج، لتنفيذ آلاف العمليات واختبار الميزات الجديدة (موردين، مخزون، عروض…) دون أي تأثير على بيانات المطعم الحقيقية.

## سياسة Schema والبيانات (مقفلة)

| الطبقة | Production | Testing |
| --- | --- | --- |
| **Migrations** (`supabase/migrations/`) | ✅ عند **بوابة الإصدار فقط** | ✅ أثناء التطوير |
| **Edge Functions** | ✅ مع الإصدار | ✅ مع Testing |
| **Schema / RPC / RLS / Buckets** | متطابق **بعد** الإصدار المعتمد | بيئة البناء والاختبار |
| **Seed والبيانات التجريبية** | ❌ ممنوع | ✅ فقط |
| **طلبات / خزن / تقارير حقيقية** | تشغيل فعلي فقط | اختبار وظيفي/مالي هنا |

**النشر الرسمي:** [`deployment-workflow.md`](./deployment-workflow.md) · [ADR-0036](./adr/0036-testing-first-deployment-workflow.md)

أثناء التطوير — بعد أي migration جديدة:

```bash
pnpm migrate:testing
```

**لا** تشغّل `migrate:production` / `migrate:schema` إلا بعد موافقة المالك على Testing، ثم:

```bash
NIHA_RELEASE_MIGRATE=1 pnpm migrate:production
# أو لمزامنة الاثنين مع المستودع عند الإصدار:
NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema
```

الـ Seed لا يُنفَّذ ضمن أوامر الـ migrate أبدًا.

| | Production | Testing |
| --- | --- | --- |
| **Project ref** | `nzwgoavyrshuypkugvzc` | `xywgmolpnhimivwmsmpw` |
| **ملف البيئة** | `.env.local` | `.env.testing` |
| **أمر التشغيل** | `pnpm dev` (منفذ 5173) | `pnpm dev:testing` (منفذ 5174) |
| **Vercel / النشر** | المشروع الحالي كما هو | لا يُنشر تلقائيًا |
| **البيانات** | تشغيل حقيقي | تجريبية فقط + شريط تحذير برتقالي |

> إعدادات Vercel ومفاتيح Production و`config.toml` project_id لا تُغيَّر لأجل Testing.

---

## 1) إعداد أولي (مرة واحدة)

### متطلبات
- Supabase CLI مسجّل الدخول (`supabase login`)
- صلاحية على مشروعَي Production و Testing

### إنشاء ملف البيئة (Testing)

```bash
pnpm env:testing
```

يكتب `.env.testing` (gitignored) بمفاتيح Testing.  
يحتاج `SUPABASE_DB_PASSWORD` لأن اتصال `db.*` المباشر IPv6 فقط وقد لا يعمل على Windows (يُستخدم Pooler IPv4).

بديل يدوي: انسخ `.env.testing.example` → `.env.testing`.

### مزامنة الـ Schema لأول مرة / عند الإصدار

```bash
pnpm migrate:testing
# بعد موافقة المالك فقط:
NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema
```

أهداف منفصلة:

```bash
pnpm migrate:testing                              # التطوير اليومي
NIHA_RELEASE_MIGRATE=1 pnpm migrate:production    # بوابة الإصدار فقط
```

### بيانات تجريبية (Testing فقط)

```bash
pnpm seed:testing
```

إعادة من الصفر:

```bash
pnpm seed:testing -- --reset
```

> `seed:testing` يرفض التنفيذ إذا كان الهدف ليس مشروع Testing.

### تشغيل الواجهة على Testing

```bash
pnpm dev:testing
```

افتح: [http://127.0.0.1:5174/login](http://127.0.0.1:5174/login)

يجب أن يظهر شريط برتقالي أعلى الشاشة:

> 🧪 بيئة اختبار (Testing) – جميع البيانات هنا تجريبية

---

## 2) حسابات الـ Seed الافتراضية

| الدور | Username | Password | PIN |
| --- | --- | --- | --- |
| مدير (owner) | `manager` | `Testing123!` | `1111` |
| كاشير | `cashier` | `Testing123!` | `2222` |

ما يشمله الـ Seed (Testing فقط):
- مطعم تجريبي + فرع
- خزائن + وسائل دفع (من migrations الهيكلية المشتركة)
- مدير + كاشير
- أصناف قائمة جاهزة للـ POS
- عملاء تجريبيون
- طابعات (كاشير/مطبخ) + جسر طباعة كـ «جهاز POS»
- وردية مفتوحة بعهدة افتتاح 500

---

## 3) تحديث Migrations لاحقًا

بعد إضافة ملف تحت `supabase/migrations/` أثناء التطوير:

```bash
pnpm migrate:testing
```

عند **بوابة الإصدار** (بعد موافقة Testing) — انظر [`deployment-workflow.md`](./deployment-workflow.md):

```bash
NIHA_RELEASE_MIGRATE=1 pnpm migrate:production
```

| الأمر | ماذا يفعل |
| --- | --- |
| `pnpm migrate:testing` | Testing فقط — **المسار اليومي** |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:production` | Production بعد موافقة المالك |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema` | Production ثم Testing عند الإصدار |

بدون `NIHA_RELEASE_MIGRATE=1` ترفض سكربتات Production migrate التنفيذ (ADR-0036).

لا تشغّل `pnpm seed:testing` على Production — السكربت محمي ويرفض عنوان Production.

---

## 4) إعادة إنشاء البيانات التجريبية

| الهدف | الأمر |
| --- | --- |
| تحديث masters التجريبية | `pnpm seed:testing` |
| حذف staff وإعادة الـ seed | `pnpm seed:testing -- --reset` |
| مسح بيانات تشغيلية تجريبية | سكربت wipe على **Testing فقط** بعد التحقق من الـ URL |

---

## 5) الفرق التشغيلي المهم

| الجانب | Production | Testing |
| --- | --- | --- |
| Schema / Migrations | نفس الملفات | نفس الملفات |
| Seed | لا | نعم |
| الطلبات / التحصيل / الخصم | بيانات حقيقية | فوضى واختبار ضغط |
| التقارير والخزن والمخزون | لا تُمس من Testing | مستقلة 100% |
| الشريط العلوي | لا يظهر | يظهر دائمًا |
| منفذ Vite | 5173 | 5174 |

`.env.local` → Production المحلي.  
`.env.testing` → يُحمَّل مع `vite --mode testing` ويتقدّم على `.env.local` لنفس المفاتيح في هذا الوضع.

---

## 6) أوامر مختصرة

| الأمر | الوظيفة |
| --- | --- |
| `pnpm env:testing` | توليد/تحديث `.env.testing` |
| `pnpm migrate:testing` | Migrations + Functions → Testing (يومي) |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:production` | → Production (بوابة إصدار) |
| `NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema` | → Production ثم Testing (إصدار) |
| `pnpm seed:testing` | بيانات تجريبية (**Testing فقط**) |
| `pnpm dev:testing` | تشغيل الواجهة على Testing |

---

## 7) ملاحظات أمان

- لا تضع مفاتيح Testing أو Production في Git.
- لا تنسخ بيانات المطعم الحقيقي إلى Testing.
- لا تربط Vercel بمشروع Testing إلا بقرار صريح منفصل.
- إن اختفى الشريط البرتقالي وأنت تعتقد أنك على Testing — توقف وتحقق من المنفذ و`VITE_APP_ENV` و`VITE_SUPABASE_URL`.
