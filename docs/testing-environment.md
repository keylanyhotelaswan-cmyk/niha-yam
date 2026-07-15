# بيئة الاختبار (Testing Environment)

**الهدف:** تشغيل NIHA على مشروع Supabase منفصل تمامًا عن الإنتاج، لتنفيذ آلاف العمليات واختبار الميزات الجديدة (موردين، مخزون، عروض…) دون أي تأثير على بيانات المطعم الحقيقية.

## سياسة Schema والبيانات (مقفلة)

| الطبقة | Production | Testing |
| --- | --- | --- |
| **Migrations** (`supabase/migrations/`) | ✅ تُطبَّق | ✅ تُطبَّق |
| **Edge Functions** | ✅ تُنشَر | ✅ تُنشَر |
| **Schema / RPC / RLS / Buckets** | متطابق | متطابق |
| **Seed والبيانات التجريبية** | ❌ ممنوع | ✅ فقط |
| **طلبات / خزن / تقارير حقيقية** | تشغيل فعلي | بيانات تجريبية منفصلة |

بعد أي migration جديدة في المستودع شغّل:

```bash
pnpm migrate:schema
```

هذا يطبّق نفس الـ Migrations على **Production ثم Testing** حتى يبقى الـ Schema متطابقًا.  
الـ Seed لا يُنفَّذ ضمن هذا الأمر أبدًا.

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

### مزامنة الـ Schema لأول مرة

```bash
pnpm migrate:schema
```

أو كل هدف على حدة:

```bash
pnpm migrate:production   # Production فقط
pnpm migrate:testing      # Testing فقط
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

بعد إضافة ملف تحت `supabase/migrations/`:

```bash
pnpm migrate:schema
```

| الأمر | ماذا يفعل |
| --- | --- |
| `pnpm migrate:schema` | Production + Testing (موصى به) |
| `pnpm migrate:production` | Production فقط |
| `pnpm migrate:testing` | Testing فقط + يستعيد رابط CLI للإنتاج |

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
| `pnpm migrate:schema` | Migrations + Functions → **Production و Testing** |
| `pnpm migrate:production` | Migrations + Functions → Production |
| `pnpm migrate:testing` | Migrations + Functions → Testing |
| `pnpm seed:testing` | بيانات تجريبية (**Testing فقط**) |
| `pnpm dev:testing` | تشغيل الواجهة على Testing |

---

## 7) ملاحظات أمان

- لا تضع مفاتيح Testing أو Production في Git.
- لا تنسخ بيانات المطعم الحقيقي إلى Testing.
- لا تربط Vercel بمشروع Testing إلا بقرار صريح منفصل.
- إن اختفى الشريط البرتقالي وأنت تعتقد أنك على Testing — توقف وتحقق من المنفذ و`VITE_APP_ENV` و`VITE_SUPABASE_URL`.
