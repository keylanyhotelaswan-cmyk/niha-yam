# تشخيص الطباعة — عربي واضح

**Status:** ✅ **Production** (2026-07-16)  
**Scope:** UX / diagnostics only for the Print Center «تشخيص» tab.

## ما تغيّر

| مسموح | غير ممسوس |
| --- | --- |
| صفحة التشخيص + قسم «كيف اختار النظام الطابعة؟» | `enqueue_*` / `claim_*` / `report_print_attempt` |
| رسائل عربية لسبب الاختيار | قالب الإيصال / أوامر المطبخ |
| اختيار يدوي عند أكثر من طابعة حرارية | منطق ESC/POS في Bridge |
| زر «تفاصيل إضافية» | إرسال مهام الطباعة من نقطة البيع |

## RPCs ذات الصلة (تشخيص / ربط فقط)

- `diagnose_print_system` — يعيد `selection` عربيًا
- `m6_match_windows_printer` / `m6_auto_bind_printers_for_bridge` — لا يخمن عند تعدد الحراريات
- `choose_cashier_windows_printer` — حفظ اختيار الكاشير

## Smoke

```bash
# Testing (كامل بما فيه sole / multi / rename)
node scripts/smoke-print-diag-arabic.mjs --env testing -- --username manager --password "…"

# Production (تشخيص عربي + وجود RPCs)
node scripts/smoke-print-diag-arabic.mjs --env production -- --username U --password "…"
```

**Results (2026-07-16):** Testing **17/17** · Production diagnose Arabic **PASS** · UI https://niha-yam.vercel.app

## Feature Freeze

Printing (M6) remains **Feature Freeze**: bug / perf / UX only. This deliverable is UX for diagnostics + safer bind when multiple thermals (no silent guess).
