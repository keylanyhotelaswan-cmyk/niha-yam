using System.Globalization;
using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Dedicated ESC/POS render for shift_handover print jobs (full shift report).</summary>
internal static class HandoverSnapshotRender
{
    public static bool TryRender(ClaimedJob job, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
        if (!string.Equals(job.Kind, "shift_handover", StringComparison.OrdinalIgnoreCase))
            return false;

        try
        {
            JsonElement root;
            if (job.Payload is JsonElement el)
                root = el;
            else
            {
                using var doc0 = JsonDocument.Parse(JsonSerializer.Serialize(job.Payload));
                root = doc0.RootElement.Clone();
            }

            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("data_snapshot", out var snap) ||
                snap.ValueKind != JsonValueKind.Object)
                return false;

            var style = ReadStyle(snap, job.Printer?.PaperWidthMm ?? 80);
            var doc = new EscPosDocument(widthDots: style.PaperWidthMm <= 58 ? 384 : 576);
            var cur = Str(snap, "currency_label") ?? "ج.م";

            TestEnvBanner.Write(doc, job);

            var title = Str(snap, "title_ar") ?? "تقرير غلق الوردية";
            doc.Line(title, EscPosAlign.Center, fontSize: style.FontTitlePt, bold: true);
            doc.Separator();

            LineKv(doc, "رقم التسليم", Str(snap, "handover_reference"), style.FontBodyPt);
            LineKv(doc, "رقم الوردية", Str(snap, "shift_reference"), style.FontBodyPt);
            LineKv(doc, "الكاشير", Str(snap, "cashier_name"), style.FontBodyPt);
            LineKv(doc, "جهة التسليم", Str(snap, "destination_label_ar"), style.FontBodyPt);

            var printedAt = Str(snap, "printed_at");
            if (!string.IsNullOrWhiteSpace(printedAt) &&
                DateTimeOffset.TryParse(printedAt, CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var dto))
            {
                LineKv(doc, "التاريخ والوقت",
                    dto.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    style.FontBodyPt);
            }
            else
            {
                LineKv(doc, "التاريخ والوقت",
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    style.FontBodyPt);
            }

            // ---- Operational summary ----
            if (snap.TryGetProperty("ops", out var ops) && ops.ValueKind == JsonValueKind.Object)
            {
                doc.DashedRule();
                doc.Line("الملخص التشغيلي", EscPosAlign.Center, fontSize: style.FontBodyPt, bold: true);
                LineKv(doc, "إجمالي المبيعات", Money(ops, "sales_total", cur), style.FontBodyPt, bold: true);
                LineKv(doc, "عدد الفواتير", IntStr(ops, "orders_count"), style.FontBodyPt);
                LineKv(doc, "متوسط الفاتورة", Money(ops, "avg_ticket", cur), style.FontBodyPt);
                LineKv(doc, "إجمالي المصروفات", Money(ops, "expenses_total", cur), style.FontBodyPt);
                var discounts = Dec(ops, "discounts_total") ?? 0m;
                if (Math.Abs(discounts) > 0.001m)
                    LineKv(doc, "الخصومات", Money(ops, "discounts_total", cur), style.FontBodyPt);
                var refunds = Dec(ops, "refunds_total") ?? 0m;
                if (Math.Abs(refunds) > 0.001m)
                    LineKv(doc, "المرتجعات", Money(ops, "refunds_total", cur), style.FontBodyPt);
                var cancelled = Int(ops, "cancelled_orders") ?? 0;
                if (cancelled > 0)
                    LineKv(doc, "فواتير ملغاة", cancelled.ToString(CultureInfo.InvariantCulture), style.FontBodyPt);
            }

            // ---- Payment methods ----
            doc.DashedRule();
            doc.Line("التحصيل حسب الوسيلة", EscPosAlign.Center, fontSize: style.FontBodyPt, bold: true);
            if (snap.TryGetProperty("payment_methods", out var methods) &&
                methods.ValueKind == JsonValueKind.Array)
            {
                var any = false;
                foreach (var m in methods.EnumerateArray())
                {
                    if (m.ValueKind != JsonValueKind.Object) continue;
                    var name = Str(m, "name") ?? Str(m, "code") ?? "وسيلة دفع";
                    var amount = Money(m, "amount", cur);
                    var toward = Bool(m, "counts_toward_handover");
                    var label = toward == true ? name : $"{name} (مراجعة)";
                    LineKv(doc, label, amount, style.FontBodyPt);
                    any = true;
                }
                if (!any)
                    doc.Line("لا توجد تحصيلات", EscPosAlign.Center, fontSize: style.FontBodyPt);
            }
            LineKv(doc, "إجمالي التحصيل", Money(snap, "total_collected", cur), style.FontTotalPt, bold: true);

            // ---- Top items ----
            WriteTopItems(doc, snap, "top_items_by_revenue", "أكثر الأصناف إيراداً", cur, style.FontBodyPt);
            WriteTopItems(doc, snap, "top_items_by_qty", "أكثر الأصناف مبيعاً", cur, style.FontBodyPt);

            // ---- Cash / trust ----
            doc.DashedRule();
            doc.Line("ملخص النقد والعهدة", EscPosAlign.Center, fontSize: style.FontBodyPt, bold: true);
            if (snap.TryGetProperty("cash", out var cash) && cash.ValueKind == JsonValueKind.Object)
            {
                LineKv(doc, "عهدة الافتتاح", Money(cash, "opening_float", cur), style.FontBodyPt);
                LineKv(doc, "رصيد البداية", Money(cash, "opening_balance", cur), style.FontBodyPt);
                LineKv(doc, "مبيعات نقدية", Money(cash, "cash_sales", cur), style.FontBodyPt);
                LineKv(doc, "النقد المتوقع", Money(cash, "expected_cash", cur), style.FontBodyPt, bold: true);
                LineKv(doc, "العد الفعلي", Money(cash, "actual_cash", cur), style.FontBodyPt, bold: true);
                var cv = Dec(cash, "variance");
                if (cv is { } v && Math.Abs(v) > 0.001m)
                    LineKv(doc, "الفرق", FormatMoney(v) + " " + cur, style.FontBodyPt, bold: true);
                LineKv(doc, "العهدة النقدية", Money(cash, "trust_amount", cur), style.FontTotalPt, bold: true);
            }
            else
            {
                LineKv(doc, "العهدة النقدية", Money(snap, "trust_amount", cur), style.FontTotalPt, bold: true);
                var variance = Dec(snap, "variance");
                if (variance is { } v && Math.Abs(v) > 0.001m)
                    LineKv(doc, "الفرق", FormatMoney(v) + " " + cur, style.FontBodyPt, bold: true);
            }

            var note = Str(snap, "trust_note_ar");
            if (!string.IsNullOrWhiteSpace(note))
                doc.Line(note!, EscPosAlign.Center, fontSize: 14f);

            if (string.Equals(Str(snap, "phase"), "receive", StringComparison.OrdinalIgnoreCase))
            {
                var recv = Str(snap, "received_by_name");
                if (!string.IsNullOrWhiteSpace(recv))
                    LineKv(doc, "استلم بواسطة", recv, style.FontBodyPt);
            }

            var footer = Str(snap, "footer_text");
            if (!string.IsNullOrWhiteSpace(footer))
            {
                doc.Separator();
                doc.Line(footer!, EscPosAlign.Center, fontSize: 14f);
            }

            doc.Separator();
            doc.Line("NIHA Print Bridge", EscPosAlign.Center, fontSize: 14f);
            if (style.AutoCut) doc.Cut(8);
            else doc.Feed(8);

            bytes = doc.ToBytes();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void WriteTopItems(
        EscPosDocument doc,
        JsonElement snap,
        string prop,
        string heading,
        string cur,
        float font)
    {
        if (!snap.TryGetProperty(prop, out var arr) || arr.ValueKind != JsonValueKind.Array)
            return;
        var items = arr.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Object).ToList();
        if (items.Count == 0) return;

        doc.DashedRule();
        doc.Line(heading, EscPosAlign.Center, fontSize: font, bold: true);
        var n = 1;
        foreach (var item in items)
        {
            var name = Str(item, "name_ar") ?? "صنف";
            var qty = Dec(item, "qty") ?? 0m;
            var sales = Money(item, "sales", cur);
            LineKv(doc, $"{n}. {name}", $"{FormatMoney(qty)} × {sales}", font);
            n++;
        }
    }

    private sealed class RenderStyle
    {
        public float FontTitlePt { get; init; } = 28f;
        public float FontBodyPt { get; init; } = 17f;
        public float FontTotalPt { get; init; } = 24f;
        public int PaperWidthMm { get; init; } = 80;
        public bool AutoCut { get; init; } = true;
    }

    private static RenderStyle ReadStyle(JsonElement snap, int printerWidthMm)
    {
        var title = 28f;
        var body = 17f;
        var total = 24f;
        var width = printerWidthMm;
        var cut = true;
        if (snap.TryGetProperty("render_style", out var st) && st.ValueKind == JsonValueKind.Object)
        {
            if (st.TryGetProperty("font_title_pt", out var t) && t.ValueKind == JsonValueKind.Number)
                title = (float)t.GetDouble();
            if (st.TryGetProperty("font_body_pt", out var b) && b.ValueKind == JsonValueKind.Number)
                body = (float)b.GetDouble();
            if (st.TryGetProperty("font_total_pt", out var tot) && tot.ValueKind == JsonValueKind.Number)
                total = (float)tot.GetDouble();
            if (st.TryGetProperty("paper_width_mm", out var w) && w.TryGetInt32(out var wi)) width = wi;
            if (st.TryGetProperty("auto_cut", out var c) && c.ValueKind is JsonValueKind.True or JsonValueKind.False)
                cut = c.GetBoolean();
        }
        return new RenderStyle
        {
            FontTitlePt = Math.Clamp(title, 14f, 40f),
            FontBodyPt = Math.Clamp(body, 12f, 32f),
            FontTotalPt = Math.Clamp(total, 14f, 40f),
            PaperWidthMm = width is 58 or 80 ? width : 80,
            AutoCut = cut,
        };
    }

    private static void LineKv(EscPosDocument doc, string? label, string? value, float font, bool bold = false)
    {
        if (string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(value)) return;
        doc.Line($"{label}: {value}", EscPosAlign.Right, fontSize: font, bold: bold);
    }

    private static string? Str(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var v) || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        var s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    private static bool? Bool(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static decimal? Dec(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String &&
            decimal.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var p))
            return p;
        return null;
    }

    private static int? Int(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        if (v.ValueKind == JsonValueKind.String &&
            int.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var p))
            return p;
        return null;
    }

    private static string? IntStr(JsonElement el, string name)
    {
        var i = Int(el, name);
        return i?.ToString(CultureInfo.InvariantCulture);
    }

    private static string Money(JsonElement el, string name, string currency)
    {
        var d = Dec(el, name) ?? 0m;
        var n = FormatMoney(d);
        return string.IsNullOrWhiteSpace(currency) ? n : $"{n} {currency}";
    }

    private static string FormatMoney(decimal d) => d.ToString("0.00", CultureInfo.InvariantCulture);
}
