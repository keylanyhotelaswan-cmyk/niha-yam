using System.Globalization;
using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Dedicated ESC/POS render for ops_message print jobs.</summary>
internal static class OpsMessageSnapshotRender
{
    public static bool TryRender(ClaimedJob job, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
        if (!string.Equals(job.Kind, "ops_message", StringComparison.OrdinalIgnoreCase))
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

            var paperMm = job.Printer?.PaperWidthMm ?? 80;
            var doc = new EscPosDocument(widthDots: paperMm <= 58 ? 384 : 576);

            var title = Str(snap, "title_ar") ?? "رسالة تشغيلية";
            doc.Line(title, EscPosAlign.Center, fontSize: 28f, bold: true);
            doc.Separator();

            LineKv(doc, "الرقم", Str(snap, "reference"), 17f);
            LineKv(doc, "المستهدف", Str(snap, "target_role"), 17f);
            LineKv(doc, "المحطة", Str(snap, "target_station"), 17f);

            var printedAt = Str(snap, "printed_at");
            if (!string.IsNullOrWhiteSpace(printedAt) &&
                DateTimeOffset.TryParse(printedAt, CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var dto))
            {
                LineKv(doc, "التاريخ والوقت",
                    dto.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    17f);
            }
            else
            {
                LineKv(doc, "التاريخ والوقت",
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
                    17f);
            }

            doc.DashedRule();
            var body = Str(snap, "body");
            if (!string.IsNullOrWhiteSpace(body))
            {
                doc.Line(body!, EscPosAlign.Right, fontSize: 20f, bold: true);
            }

            doc.Separator();
            doc.Line("NIHA Print Bridge", EscPosAlign.Center, fontSize: 14f);
            doc.Cut(8);

            bytes = doc.ToBytes();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void LineKv(EscPosDocument doc, string? label, string? value, float font)
    {
        if (string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(value)) return;
        doc.Line($"{label}: {value}", EscPosAlign.Right, fontSize: font);
    }

    private static string? Str(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var v) || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        var s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }
}
