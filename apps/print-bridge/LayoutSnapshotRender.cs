using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Renders order snapshots honoring layout.section_order + section.fields.</summary>
internal static class LayoutSnapshotRender
{
    public static bool TryRender(ClaimedJob job, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
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

            var isKitchen = string.Equals(job.Kind, "kitchen", StringComparison.OrdinalIgnoreCase);
            var legacy = ReadLegacyStyle(snap, job.Printer?.PaperWidthMm ?? 80);
            var layout = ReadLayout(snap, isKitchen, legacy);
            var doc = new EscPosDocument(widthDots: layout.PaperWidthMm <= 58 ? 384 : 576);
            var cur = Str(snap, "currency_label") ?? "";

            TestEnvBanner.Write(doc, job);

            if (root.TryGetProperty("reprint", out var rp) && rp.ValueKind == JsonValueKind.True)
                doc.Line("★ إعادة طباعة ★", EscPosAlign.Center, fontSize: 15f, bold: true);

            var emitted = 0;
            foreach (var sectionId in layout.Order)
            {
                var section = layout.Get(sectionId);
                if (section is null) continue;

                // Rules only between real content — never before the first line
                // (leading feeds create a large blank top margin on the ticket).
                if (emitted > 0 && sectionId is "invoice_meta" or "order_meta")
                    doc.SolidRule();
                if (emitted > 0 && sectionId is "lines" or "totals" or "order_note")
                    doc.DashedRule();

                // space_before only BETWEEN sections — never above the first printed line
                if (emitted > 0 && section.SpaceBefore > 0)
                    doc.Feed(section.SpaceBefore);

                var wrote = RenderSection(doc, section, sectionId, snap, job, isKitchen, cur);
                if (!wrote) continue;

                if (section.SpaceAfter > 0) doc.Feed(section.SpaceAfter);
                emitted++;
            }

            if (emitted == 0)
            {
                doc.Line(job.Reference ?? "PRINT", EscPosAlign.Center, fontSize: 16f, bold: true);
            }

            var footer = Str(snap, "footer_text");
            if (!string.IsNullOrWhiteSpace(footer))
                doc.Line(footer!, EscPosAlign.Center, fontSize: 14f);

            // Feed past the cutter (above the print head), then cut.
            // Kitchen tickets use taller Arabic bitmaps; too little feed slices
            // the last lines (شكراً) or cuts before they clear the blade.
            var cutFeed = isKitchen ? 14 : 8;
            if (legacy.AutoCut) doc.Cut(cutFeed);
            else doc.Feed(cutFeed);

            bytes = doc.ToBytes();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool RenderSection(
        EscPosDocument doc,
        SectionStyle section,
        string sectionId,
        JsonElement snap,
        ClaimedJob job,
        bool isKitchen,
        string cur)
    {
        var wrote = false;
        bool Field(string id, string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            var f = section.GetField(id);
            if (f is null) return false;
            doc.Line(text!, f.Align, fontSize: f.FontPt, bold: f.Bold);
            wrote = true;
            return true;
        }

        // All document labels come from template field.label_ar / label_en only (BP-15).
        bool FieldLabeled(string id, string? rawValue)
        {
            var f = section.GetField(id);
            if (f is null || string.IsNullOrWhiteSpace(rawValue)) return false;
            var text = ComposeFieldText(f, rawValue!);
            if (string.IsNullOrWhiteSpace(text)) return false;
            doc.Line(text!, f.Align, fontSize: f.FontPt, bold: f.Bold);
            wrote = true;
            return true;
        }

        bool FieldLabelContent(string id)
        {
            var f = section.GetField(id);
            if (f is null) return false;
            var text = ResolveLabelOnly(f);
            if (string.IsNullOrWhiteSpace(text)) return false;
            doc.Line(text!, f.Align, fontSize: f.FontPt, bold: f.Bold);
            wrote = true;
            return true;
        }

        switch (sectionId)
        {
            case "restaurant_name":
                Field("name", Str(snap, "restaurant_name"));
                return wrote;
            case "slogan":
                Field("text", Str(snap, "slogan"));
                return wrote;
            case "ticket_header":
                FieldLabelContent("title");
                return wrote;
            case "branch_info":
                Field("address", Str(snap, "restaurant_address"));
                Field("phone", Str(snap, "restaurant_phone"));
                return wrote;
            case "invoice_meta":
            case "order_meta":
                if (isKitchen)
                    FieldLabeled("order_reference", Str(snap, "order_reference"));
                else
                {
                    FieldLabeled("invoice_number", Str(snap, "order_reference") ?? job.Reference);
                    FieldLabeled("order_reference", Str(snap, "order_reference"));
                }
                if (isKitchen)
                    FieldLabeled("kitchen_ticket", Str(snap, "kitchen_ticket"));
                FieldLabeled("order_type", Str(snap, "order_type_ar") ?? Str(snap, "order_type"));
                FieldLabeled("created_by_name",
                    Str(snap, "created_by_name") ?? Str(snap, "cashier"));
                if (!isKitchen)
                {
                    FieldLabeled("last_edited_by_name", Str(snap, "last_edited_by_name"));
                    FieldLabeled("collected_by_name", Str(snap, "collected_by_name"));
                }
                FieldLabeled("created_at", Str(snap, "created_at"));
                if (!isKitchen)
                {
                    FieldLabeled("last_edited_at", Str(snap, "last_edited_at"));
                    FieldLabeled("collected_at", Str(snap, "collected_at"));
                }
                FieldLabeled("printed_at",
                    Str(snap, "printed_at") ?? Str(snap, "datetime"));
                // Legacy templates still using cashier/datetime field ids
                FieldLabeled("cashier", Str(snap, "created_by_name") ?? Str(snap, "cashier"));
                Field("datetime", Str(snap, "printed_at") ?? Str(snap, "datetime"));
                return wrote;
            case "customer":
            case "customer_or_table":
                FieldLabeled("table_ref", Str(snap, "table_ref"));
                FieldLabeled("customer_name", Str(snap, "customer_name"));
                FieldLabeled("customer_phone", Str(snap, "customer_phone"));
                FieldLabeled("delivery_zone", Str(snap, "delivery_zone"));
                FieldLabeled("delivery_address", Str(snap, "delivery_address"));
                if (!isKitchen)
                    FieldLabeled("delivery_notes", Str(snap, "delivery_notes"));
                FieldLabeled("driver_name", Str(snap, "driver_name"));
                return wrote;
            case "ops":
                FieldLabeled("shift_reference", Str(snap, "shift_reference"));
                FieldLabeled("branch_name",
                    Str(snap, "branch_name") ?? Str(snap, "restaurant_name"));
                FieldLabeled("device_name", Str(snap, "device_name"));
                return wrote;
            case "lines":
                if (!snap.TryGetProperty("lines", out var lines) || lines.ValueKind != JsonValueKind.Array)
                    return false;
                foreach (var line in lines.EnumerateArray())
                {
                    var name = Str(line, "name") ?? "";
                    var qty = line.TryGetProperty("quantity", out var q) ? FormatNum(q) : "1";
                    var itemLabel = $"{qty}x {name}";
                    var itemF = section.GetField("item_line");
                    var priceF = section.GetField("price");
                    if (isKitchen)
                    {
                        if (itemF is not null)
                        {
                            doc.Line(itemLabel, itemF.Align, fontSize: itemF.FontPt, bold: itemF.Bold);
                            wrote = true;
                        }
                    }
                    else if (itemF is not null && priceF is not null)
                    {
                        var money = line.TryGetProperty("line_total", out var lt) ? Money(lt, cur) : "";
                        doc.Columns(itemLabel, money, itemF.FontPt, bold: itemF.Bold);
                        wrote = true;
                    }
                    else if (itemF is not null)
                    {
                        doc.Line(itemLabel, itemF.Align, fontSize: itemF.FontPt, bold: itemF.Bold);
                        wrote = true;
                    }

                    var modF = section.GetField("modifiers");
                    if (modF is not null &&
                        line.TryGetProperty("modifiers", out var mods) &&
                        mods.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var m in mods.EnumerateArray())
                        {
                            var modName = m.ValueKind == JsonValueKind.String ? m.GetString() : Str(m, "name");
                            if (string.IsNullOrWhiteSpace(modName)) continue;
                            var delta = "";
                            if (!isKitchen && m.ValueKind == JsonValueKind.Object &&
                                m.TryGetProperty("price_delta", out var pd) &&
                                pd.ValueKind == JsonValueKind.Number && pd.GetDecimal() != 0)
                                delta = $" ({Money(pd, cur)})";
                            doc.Line($"  + {modName}{delta}", modF.Align, fontSize: modF.FontPt, bold: modF.Bold);
                            wrote = true;
                        }
                    }

                    var noteF = section.GetField("note");
                    var note = Str(line, "note");
                    if (noteF is not null && !string.IsNullOrWhiteSpace(note))
                    {
                        foreach (var row in SplitKitchenNote(note))
                        {
                            doc.Line($"  {row}", noteF.Align, fontSize: noteF.FontPt, bold: noteF.Bold);
                            wrote = true;
                        }
                    }
                }
                return wrote;
            case "order_note":
                FieldLabeled("note", Str(snap, "order_note"));
                return wrote;
            case "totals":
                if (isKitchen) return false;
                {
                    var discF = section.GetField("discount");
                    var subF = section.GetField("subtotal");
                    var taxF = section.GetField("tax");
                    var totalF = section.GetField("total");
                    if (snap.TryGetProperty("discount_amount", out var disc) &&
                        disc.ValueKind == JsonValueKind.Number && disc.GetDecimal() > 0)
                    {
                        if (subF is not null && snap.TryGetProperty("subtotal", out var sub))
                        {
                            var subLabel = ResolveLabelOnly(subF) ?? "";
                            doc.Columns(subLabel, Money(sub, cur), subF.FontPt, bold: subF.Bold);
                            wrote = true;
                        }
                        if (discF is not null)
                        {
                            var discLabel = ResolveLabelOnly(discF) ?? "";
                            doc.Columns(discLabel, Money(disc, cur), discF.FontPt, bold: discF.Bold);
                            wrote = true;
                        }
                        doc.Feed(1);
                    }
                    if (taxF is not null &&
                        snap.TryGetProperty("tax_amount", out var tax) &&
                        tax.ValueKind == JsonValueKind.Number && tax.GetDecimal() > 0)
                    {
                        var taxLabel = ResolveLabelOnly(taxF) ?? "";
                        doc.Columns(taxLabel, Money(tax, cur), taxF.FontPt, bold: taxF.Bold);
                        wrote = true;
                        doc.Feed(1);
                    }
                    if (totalF is not null)
                    {
                        var totalText = snap.TryGetProperty("total", out var totalEl) ? Money(totalEl, cur) : "";
                        var totalLabel = ResolveLabelOnly(totalF);
                        var boxLines = new List<(string, float, bool)>();
                        if (!string.IsNullOrWhiteSpace(totalLabel))
                            boxLines.Add((totalLabel!, Math.Max(12f, totalF.FontPt - 4), true));
                        boxLines.Add((totalText, totalF.FontPt, totalF.Bold));
                        doc.Box(boxLines);
                        wrote = true;
                    }
                }
                return wrote;
            case "payment":
                if (isKitchen) return false;
                {
                    var linesF = section.GetField("payment_lines");
                    if (linesF is not null &&
                        snap.TryGetProperty("payments", out var pays) &&
                        pays.ValueKind == JsonValueKind.Array)
                    {
                        var header = ResolveLabelOnly(linesF);
                        if (!string.IsNullOrWhiteSpace(header))
                        {
                            doc.Line(header!, linesF.Align, fontSize: linesF.FontPt, bold: linesF.Bold);
                            wrote = true;
                        }
                        foreach (var p in pays.EnumerateArray())
                        {
                            var payName = Str(p, "method");
                            if (string.IsNullOrWhiteSpace(payName)) continue;
                            JsonElement amtEl = default;
                            if (p.TryGetProperty("net_amount", out var na) && na.ValueKind == JsonValueKind.Number)
                                amtEl = na;
                            else if (p.TryGetProperty("amount", out var am) && am.ValueKind == JsonValueKind.Number)
                                amtEl = am;
                            else
                                continue;
                            doc.Columns(payName!, Money(amtEl, cur), linesF.FontPt, bold: linesF.Bold);
                            wrote = true;
                        }
                        if (wrote) doc.Feed(1);
                    }

                    var methodF = section.GetField("method");
                    var statusF = section.GetField("status");
                    var changeF = section.GetField("change");
                    var payMethod = Str(snap, "payment_method");
                    if (string.IsNullOrWhiteSpace(payMethod) &&
                        snap.TryGetProperty("payments", out var pays0) &&
                        pays0.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in pays0.EnumerateArray())
                        {
                            payMethod = Str(p, "method");
                            if (!string.IsNullOrWhiteSpace(payMethod)) break;
                        }
                    }
                    var statusAr = Str(snap, "payment_status_ar");
                    var payRight = methodF is not null && !string.IsNullOrWhiteSpace(payMethod)
                        ? ComposeFieldText(methodF, payMethod!) ?? ""
                        : "";
                    var payLeft = statusF is not null && !string.IsNullOrWhiteSpace(statusAr)
                        ? ComposeFieldText(statusF, statusAr!) ?? ""
                        : "";
                    if (!string.IsNullOrWhiteSpace(payRight) || !string.IsNullOrWhiteSpace(payLeft))
                    {
                        var pt = methodF?.FontPt ?? statusF?.FontPt ?? section.FontPt;
                        var bold = methodF?.Bold ?? statusF?.Bold ?? section.Bold;
                        doc.Box(new List<(string, float, bool)>
                        {
                            ($"{payRight}    {payLeft}".Trim(), pt, bold),
                        });
                        wrote = true;
                    }
                    if (changeF is not null &&
                        snap.TryGetProperty("change_total", out var chg) &&
                        chg.ValueKind == JsonValueKind.Number && chg.GetDecimal() > 0)
                    {
                        doc.Feed(1);
                        var changeLabel = ResolveLabelOnly(changeF) ?? "";
                        doc.Columns(changeLabel, Money(chg, cur), changeF.FontPt, bold: changeF.Bold);
                        wrote = true;
                    }
                }
                return wrote;
            case "qr":
                if (!isKitchen &&
                    snap.TryGetProperty("show_qr", out var showQr) &&
                    showQr.ValueKind == JsonValueKind.True)
                    Field("code", "[ QR ]");
                return wrote;
            case "thank_you":
                Field("message", Str(snap, "thank_you"));
                return wrote;
            default:
                return false;
        }
    }

    private sealed record FieldStyle(
        float FontPt,
        EscPosAlign Align,
        bool Bold,
        string? LabelAr = null,
        string? LabelEn = null,
        string LabelMode = "ar",
        string ValueFormat = "default");

    private sealed class SectionStyle
    {
        public float FontPt { get; init; }
        public EscPosAlign Align { get; init; }
        public bool Bold { get; init; }
        public int SpaceBefore { get; init; }
        public int SpaceAfter { get; init; }
        public Dictionary<string, FieldStyle> Fields { get; init; } = new(StringComparer.Ordinal);
        public FieldStyle? GetField(string id) => Fields.TryGetValue(id, out var f) ? f : null;
    }

    private sealed class DocLayout
    {
        public int PaperWidthMm { get; init; } = 80;
        public List<string> Order { get; init; } = new();
        public Dictionary<string, SectionStyle> Sections { get; init; } = new();
        public SectionStyle? Get(string id) => Sections.TryGetValue(id, out var s) ? s : null;
    }

    private sealed class LegacyStyle
    {
        public float FontTitlePt { get; init; } = 28f;
        public float FontBodyPt { get; init; } = 17f;
        public float FontTotalPt { get; init; } = 24f;
        public int PaperWidthMm { get; init; } = 80;
        public bool AutoCut { get; init; } = true;
    }

    private static LegacyStyle ReadLegacyStyle(JsonElement snap, int printerWidthMm)
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
        return new LegacyStyle
        {
            FontTitlePt = Math.Clamp(title, 14f, 40f),
            FontBodyPt = Math.Clamp(body, 12f, 32f),
            FontTotalPt = Math.Clamp(total, 14f, 40f),
            PaperWidthMm = width is 58 or 80 ? width : 80,
            AutoCut = cut,
        };
    }

    private static DocLayout ReadLayout(JsonElement snap, bool isKitchen, LegacyStyle legacy)
    {
        var paper = legacy.PaperWidthMm;
        var sections = new Dictionary<string, SectionStyle>(StringComparer.Ordinal);
        var order = new List<string>();

        void Put(string id, float font, EscPosAlign align, bool bold, int before, int after,
            params (string fieldId, float font, EscPosAlign align, bool bold)[] fields)
        {
            var map = new Dictionary<string, FieldStyle>(StringComparer.Ordinal);
            foreach (var (fid, ff, fa, fb) in fields)
                map[fid] = new FieldStyle(ff, fa, fb);
            sections[id] = new SectionStyle
            {
                FontPt = font, Align = align, Bold = bold,
                SpaceBefore = before, SpaceAfter = after, Fields = map,
            };
            order.Add(id);
        }

        if (isKitchen)
        {
            Put("restaurant_name", legacy.FontTitlePt, EscPosAlign.Center, true, 0, 2,
                ("name", legacy.FontTitlePt, EscPosAlign.Center, true));
            Put("ticket_header", legacy.FontBodyPt, EscPosAlign.Center, true, 0, 2,
                ("title", legacy.FontBodyPt, EscPosAlign.Center, true));
            Put("order_meta", legacy.FontBodyPt, EscPosAlign.Right, true, 0, 2,
                ("order_reference", legacy.FontBodyPt, EscPosAlign.Right, true),
                ("datetime", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Right, false),
                ("cashier", legacy.FontBodyPt, EscPosAlign.Right, false),
                ("order_type", legacy.FontBodyPt, EscPosAlign.Right, false),
                ("kitchen_ticket", legacy.FontBodyPt, EscPosAlign.Right, true));
            Put("customer_or_table", legacy.FontBodyPt, EscPosAlign.Right, true, 0, 2,
                ("table_ref", legacy.FontBodyPt, EscPosAlign.Right, true),
                ("customer_name", legacy.FontBodyPt, EscPosAlign.Right, true));
            Put("lines", Math.Max(legacy.FontTitlePt - 4, 18), EscPosAlign.Right, true, 2, 2,
                ("item_line", Math.Max(legacy.FontTitlePt - 4, 18), EscPosAlign.Right, true),
                ("modifiers", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Right, false),
                ("note", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Right, false));
            Put("order_note", legacy.FontBodyPt, EscPosAlign.Right, true, 2, 2,
                ("note", legacy.FontBodyPt, EscPosAlign.Right, true));
            Put("thank_you", legacy.FontBodyPt, EscPosAlign.Center, true, 2, 4,
                ("message", legacy.FontBodyPt, EscPosAlign.Center, true));
        }
        else
        {
            Put("restaurant_name", legacy.FontTitlePt, EscPosAlign.Center, true, 0, 2,
                ("name", legacy.FontTitlePt, EscPosAlign.Center, true));
            Put("slogan", Math.Max(12f, legacy.FontBodyPt - 3), EscPosAlign.Center, false, 0, 2,
                ("text", Math.Max(12f, legacy.FontBodyPt - 3), EscPosAlign.Center, false));
            Put("branch_info", Math.Max(12f, legacy.FontBodyPt - 3), EscPosAlign.Center, false, 0, 2,
                ("address", Math.Max(12f, legacy.FontBodyPt - 3), EscPosAlign.Center, false),
                ("phone", Math.Max(12f, legacy.FontBodyPt - 3), EscPosAlign.Center, true));
            Put("invoice_meta", legacy.FontBodyPt, EscPosAlign.Right, true, 0, 2,
                ("invoice_number", legacy.FontBodyPt, EscPosAlign.Right, true),
                ("datetime", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Right, false),
                ("cashier", legacy.FontBodyPt, EscPosAlign.Right, false),
                ("order_type", legacy.FontBodyPt, EscPosAlign.Right, false));
            Put("customer", legacy.FontBodyPt, EscPosAlign.Right, false, 0, 2,
                ("customer_name", legacy.FontBodyPt, EscPosAlign.Right, false),
                ("customer_phone", Math.Max(10f, legacy.FontBodyPt - 1), EscPosAlign.Right, false),
                ("delivery_address", Math.Max(10f, legacy.FontBodyPt - 1), EscPosAlign.Right, false),
                ("table_ref", legacy.FontBodyPt, EscPosAlign.Right, true));
            Put("lines", legacy.FontBodyPt, EscPosAlign.Right, true, 2, 2,
                ("item_line", legacy.FontBodyPt, EscPosAlign.Right, true),
                ("price", legacy.FontBodyPt, EscPosAlign.Right, true),
                ("modifiers", Math.Max(10f, legacy.FontBodyPt - 3), EscPosAlign.Right, false),
                ("note", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Right, false));
            Put("totals", legacy.FontTotalPt, EscPosAlign.Center, true, 4, 2,
                ("subtotal", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Center, false),
                ("discount", Math.Max(10f, legacy.FontBodyPt - 2), EscPosAlign.Center, false),
                ("total", legacy.FontTotalPt, EscPosAlign.Center, true));
            Put("payment", Math.Max(12f, legacy.FontBodyPt - 2), EscPosAlign.Center, true, 2, 2,
                ("method", Math.Max(12f, legacy.FontBodyPt - 2), EscPosAlign.Center, true),
                ("status", Math.Max(12f, legacy.FontBodyPt - 2), EscPosAlign.Center, true),
                ("change", Math.Max(12f, legacy.FontBodyPt - 2), EscPosAlign.Center, true));
            Put("qr", 14f, EscPosAlign.Center, false, 2, 2,
                ("code", 14f, EscPosAlign.Center, false));
            Put("thank_you", legacy.FontBodyPt, EscPosAlign.Center, true, 2, 2,
                ("message", legacy.FontBodyPt, EscPosAlign.Center, true));
        }

        if (snap.TryGetProperty("layout", out var layoutEl) && layoutEl.ValueKind == JsonValueKind.Object)
        {
            if (layoutEl.TryGetProperty("paper_width_mm", out var w) && w.TryGetInt32(out var wi) && wi is 58 or 80)
                paper = wi;

            // Merge section styles FIRST so later section_order can include
            // sections that only exist in the saved layout (e.g. kitchen thank_you).
            if (layoutEl.TryGetProperty("sections", out var secs) && secs.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in secs.EnumerateObject())
                {
                    if (p.Value.ValueKind != JsonValueKind.Object) continue;
                    var visible = !(p.Value.TryGetProperty("visible", out var vis) &&
                                    vis.ValueKind == JsonValueKind.False);
                    if (!visible)
                    {
                        sections.Remove(p.Name);
                        order.Remove(p.Name);
                        continue;
                    }

                    sections.TryGetValue(p.Name, out var prev);
                    var font = prev?.FontPt ?? legacy.FontBodyPt;
                    var align = prev?.Align ?? EscPosAlign.Right;
                    var bold = prev?.Bold ?? false;
                    var before = prev?.SpaceBefore ?? 0;
                    var after = prev?.SpaceAfter ?? 2;
                    var fields = prev is not null
                        ? new Dictionary<string, FieldStyle>(prev.Fields, StringComparer.Ordinal)
                        : new Dictionary<string, FieldStyle>(StringComparer.Ordinal);

                    if (p.Value.TryGetProperty("font_pt", out var fp) && fp.ValueKind == JsonValueKind.Number)
                        font = Math.Clamp((float)fp.GetDouble(), 10f, 40f);
                    if (p.Value.TryGetProperty("align", out var al) && al.ValueKind == JsonValueKind.String)
                        align = ParseAlign(al.GetString());
                    if (p.Value.TryGetProperty("bold", out var b) && b.ValueKind is JsonValueKind.True or JsonValueKind.False)
                        bold = b.GetBoolean();
                    if (p.Value.TryGetProperty("space_before", out var sb) && sb.TryGetInt32(out var sbi))
                        before = Math.Clamp(sbi, 0, 12);
                    if (p.Value.TryGetProperty("space_after", out var sa) && sa.TryGetInt32(out var sai))
                        after = Math.Clamp(sai, 0, 12);

                    if (p.Value.TryGetProperty("fields", out var flds) && flds.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var fp2 in flds.EnumerateObject())
                        {
                            if (fp2.Value.ValueKind != JsonValueKind.Object) continue;
                            if (fp2.Value.TryGetProperty("visible", out var fv) && fv.ValueKind == JsonValueKind.False)
                            {
                                fields.Remove(fp2.Name);
                                continue;
                            }
                            fields.TryGetValue(fp2.Name, out var pf);
                            var ff = pf?.FontPt ?? font;
                            var fa = pf?.Align ?? align;
                            var fb = pf?.Bold ?? bold;
                            string? labelAr = pf?.LabelAr;
                            string? labelEn = pf?.LabelEn;
                            var labelMode = pf?.LabelMode ?? "ar";
                            var valueFormat = pf?.ValueFormat ?? "default";
                            if (fp2.Value.TryGetProperty("font_pt", out var fpt) && fpt.ValueKind == JsonValueKind.Number)
                                ff = Math.Clamp((float)fpt.GetDouble(), 10f, 40f);
                            if (fp2.Value.TryGetProperty("align", out var fal) && fal.ValueKind == JsonValueKind.String)
                                fa = ParseAlign(fal.GetString());
                            if (fp2.Value.TryGetProperty("bold", out var fbo) && fbo.ValueKind is JsonValueKind.True or JsonValueKind.False)
                                fb = fbo.GetBoolean();
                            if (fp2.Value.TryGetProperty("label_ar", out var lar) && lar.ValueKind == JsonValueKind.String)
                                labelAr = lar.GetString();
                            if (fp2.Value.TryGetProperty("label_en", out var len) && len.ValueKind == JsonValueKind.String)
                                labelEn = len.GetString();
                            if (fp2.Value.TryGetProperty("label_mode", out var lm) && lm.ValueKind == JsonValueKind.String)
                                labelMode = lm.GetString() ?? "ar";
                            if (fp2.Value.TryGetProperty("value_format", out var vf) && vf.ValueKind == JsonValueKind.String)
                                valueFormat = vf.GetString() ?? "default";
                            fields[fp2.Name] = new FieldStyle(ff, fa, fb, labelAr, labelEn, labelMode, valueFormat);
                        }
                    }

                    sections[p.Name] = new SectionStyle
                    {
                        FontPt = font, Align = align, Bold = bold,
                        SpaceBefore = before, SpaceAfter = after, Fields = fields,
                    };
                    if (!order.Contains(p.Name)) order.Add(p.Name);
                }
            }

            if (layoutEl.TryGetProperty("section_order", out var ord) && ord.ValueKind == JsonValueKind.Array)
            {
                var next = new List<string>();
                foreach (var el in ord.EnumerateArray())
                {
                    var id = el.GetString();
                    if (!string.IsNullOrWhiteSpace(id) && sections.ContainsKey(id!) && !next.Contains(id!))
                        next.Add(id!);
                }
                foreach (var id in order)
                    if (!next.Contains(id)) next.Add(id);
                if (next.Count > 0) order = next;
            }
        }

        return new DocLayout { PaperWidthMm = paper, Order = order, Sections = sections };
    }

    private static EscPosAlign ParseAlign(string? a) => a switch
    {
        "left" => EscPosAlign.Left,
        "center" => EscPosAlign.Center,
        _ => EscPosAlign.Right,
    };

    private static string Money(JsonElement el, string currencyLabel)
    {
        var n = el.ValueKind == JsonValueKind.Number && el.TryGetDecimal(out var d)
            ? d.ToString("0.00")
            : el.ToString();
        return string.IsNullOrWhiteSpace(currencyLabel) ? n : $"{n} {currencyLabel}";
    }

    private static string FormatNum(JsonElement el) =>
        el.ValueKind == JsonValueKind.Number ? el.ToString() : el.GetString() ?? "1";

    private static string ShortReference(string raw)
    {
        var trimmed = raw.Trim();
        if (trimmed.Length == 0) return "";
        var m = System.Text.RegularExpressions.Regex.Match(trimmed, @"^(?:[A-Za-z]+-)?0*(\d+)$");
        if (m.Success) return m.Groups[1].Value;
        var last = trimmed.Contains('-') ? trimmed.Split('-')[^1] : trimmed;
        var stripped = last.TrimStart('0');
        return stripped.Length > 0 ? stripped : "0";
    }

    /// <summary>Label text from template only — never invent document copy in Bridge.</summary>
    private static string? ResolveLabelOnly(FieldStyle f)
    {
        var mode = string.IsNullOrWhiteSpace(f.LabelMode) ? "ar" : f.LabelMode!;
        if (string.Equals(mode, "none", StringComparison.OrdinalIgnoreCase))
            return null;

        var ar = (f.LabelAr ?? "").Trim();
        var en = (f.LabelEn ?? "").Trim();

        if (string.Equals(mode, "en", StringComparison.OrdinalIgnoreCase))
            return en.Length > 0 ? en : (ar.Length > 0 ? ar : null);
        if (string.Equals(mode, "both", StringComparison.OrdinalIgnoreCase))
        {
            if (ar.Length > 0 && en.Length > 0) return $"{en} / {ar}";
            return en.Length > 0 ? en : (ar.Length > 0 ? ar : null);
        }
        return ar.Length > 0 ? ar : null;
    }

    private static string? ComposeFieldText(FieldStyle f, string raw)
    {
        var value = string.Equals(f.ValueFormat, "number_only", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(f.ValueFormat, "short", StringComparison.OrdinalIgnoreCase)
            ? ShortReference(raw)
            : raw.Trim();
        if (string.IsNullOrWhiteSpace(value)) return null;

        var mode = string.IsNullOrWhiteSpace(f.LabelMode) ? "ar" : f.LabelMode;
        if (string.Equals(mode, "none", StringComparison.OrdinalIgnoreCase))
            return value;

        var prefix = ResolveLabelOnly(f) ?? "";
        if (prefix.Length == 0) return value;
        if (prefix.EndsWith(':') || prefix.EndsWith('：') || prefix.EndsWith('#'))
            return prefix + value;
        return $"{prefix}: {value}";
    }

    private static string? Str(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var v) || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        var s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    /// <summary>
    /// Line notes print as-is (labels already in POS note text or absent).
    /// Bridge never prefixes document copy.
    /// </summary>
    private static IEnumerable<string> SplitKitchenNote(string note)
    {
        var text = note.Trim();
        if (text.Length == 0) yield break;

        if (text.Contains(" · ", StringComparison.Ordinal) ||
            text.Contains(" | ", StringComparison.Ordinal) ||
            text.Contains(" — ", StringComparison.Ordinal))
        {
            foreach (var part in text.Split(new[] { " · ", " | ", " — " }, StringSplitOptions.None))
            {
                var row = part.Trim();
                if (row.Length > 0) yield return row;
            }
            yield break;
        }

        yield return text;
    }
}
