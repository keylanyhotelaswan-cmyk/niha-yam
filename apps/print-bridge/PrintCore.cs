using System.Text.Json;
using ArabicRt;
using Microsoft.Data.Sqlite;

namespace Niha.PrintBridge;

/// <summary>Local durable buffer for offline results (BP-4) — TTL still enforced server-side.</summary>
public sealed class OfflineStore : IDisposable
{
    private readonly SqliteConnection _db;

    public OfflineStore(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _db = new SqliteConnection($"Data Source={path}");
        _db.Open();
        using var cmd = _db.CreateCommand();
        cmd.CommandText =
            """
            CREATE TABLE IF NOT EXISTS pending_reports (
              job_id TEXT PRIMARY KEY,
              success INTEGER NOT NULL,
              error_code TEXT,
              error_message TEXT,
              delivery TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """;
        cmd.ExecuteNonQuery();
    }

    public void EnqueueReport(Guid jobId, bool success, string? code, string? message, string delivery)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText =
            """
            INSERT OR REPLACE INTO pending_reports(job_id, success, error_code, error_message, delivery, created_at)
            VALUES ($id, $ok, $code, $msg, $del, $at);
            """;
        cmd.Parameters.AddWithValue("$id", jobId.ToString());
        cmd.Parameters.AddWithValue("$ok", success ? 1 : 0);
        cmd.Parameters.AddWithValue("$code", (object?)code ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$msg", (object?)message ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$del", delivery);
        cmd.Parameters.AddWithValue("$at", DateTimeOffset.UtcNow.ToString("O"));
        cmd.ExecuteNonQuery();
    }

    public List<(Guid Id, bool Ok, string? Code, string? Msg, string Delivery)> ListPending()
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT job_id, success, error_code, error_message, delivery FROM pending_reports ORDER BY created_at;";
        using var r = cmd.ExecuteReader();
        var list = new List<(Guid, bool, string?, string?, string)>();
        while (r.Read())
        {
            list.Add((
                Guid.Parse(r.GetString(0)),
                r.GetInt64(1) == 1,
                r.IsDBNull(2) ? null : r.GetString(2),
                r.IsDBNull(3) ? null : r.GetString(3),
                r.GetString(4)));
        }
        return list;
    }

    public void Remove(Guid jobId)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "DELETE FROM pending_reports WHERE job_id = $id;";
        cmd.Parameters.AddWithValue("$id", jobId.ToString());
        cmd.ExecuteNonQuery();
    }

    public void Dispose() => _db.Dispose();
}

/// <summary>
/// Minimal ESC/POS builder from payload snapshot only (BP-10 / BP-13).
/// Arabic lines are shaped (ArabicRt) and rasterized for correct joining.
/// </summary>
public static class EscPosRenderer
{
    public static byte[] Render(ClaimedJob job)
    {
        if (string.Equals(job.Kind, "test_page", StringComparison.OrdinalIgnoreCase))
            return RenderTestPage(job);

        if (HandoverSnapshotRender.TryRender(job, out var fromHandover))
            return fromHandover;

        if (OpsMessageSnapshotRender.TryRender(job, out var fromOps))
            return fromOps;

        if (TryRenderSnapshot(job, out var fromSnapshot))
            return fromSnapshot;

        var doc = new EscPosDocument(widthDots: job.Printer?.PaperWidthMm <= 58 ? 384 : 576);
        doc.Line(job.Kind?.ToUpperInvariant() ?? "PRINT", EscPosAlign.Center, bold: true);
        doc.Line(job.Reference ?? job.Id.ToString("N")[..8], EscPosAlign.Center);
        doc.Line(DateTime.Now.ToString("yyyy-MM-dd HH:mm"), EscPosAlign.Center, fontSize: 14f);
        doc.Separator();

        try
        {
            AppendPayload(doc, job.Payload);
        }
        catch
        {
            doc.Line("(payload)", EscPosAlign.Left, fontSize: 14f);
        }

        doc.Separator();
        doc.Line("NIHA Bridge", EscPosAlign.Center, fontSize: 14f);
        doc.Cut();
        return doc.ToBytes();
    }

    private static bool TryRenderSnapshot(ClaimedJob job, out byte[] bytes)
        => LayoutSnapshotRender.TryRender(job, out bytes);

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

    private static string Money(JsonElement el, string currencyLabel)
    {
        var n = FormatMoney(el);
        return string.IsNullOrWhiteSpace(currencyLabel) ? n : $"{n} {currencyLabel}";
    }

    private static string FormatMoney(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.Number && el.TryGetDecimal(out var d))
            return d.ToString("0.00");
        return el.ToString();
    }

    private static string FormatNum(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.Number) return el.ToString();
        return el.GetString() ?? "1";
    }

    private static string? Str(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var v) || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        var s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    private static byte[] RenderTestPage(ClaimedJob job)
    {
        var width = job.Printer?.PaperWidthMm <= 58 ? 384 : 576;
        var doc = new EscPosDocument(widthDots: width);
        doc.Line("NIHA", EscPosAlign.Center, fontSize: 28f, bold: true);
        doc.Line("Print Bridge", EscPosAlign.Center, fontSize: 18f, bold: true);
        doc.Line("اختبار طباعة من مركز الطباعة", EscPosAlign.Center, fontSize: 18f, bold: true);
        doc.Separator();
        doc.Line(job.Printer?.Name ?? "طابعة", EscPosAlign.Center, fontSize: 20f, bold: true);
        doc.Line($"الوقت: {DateTime.Now:yyyy-MM-dd HH:mm:ss}", EscPosAlign.Center, fontSize: 16f);
        doc.Separator();
        doc.Line("برجر لحم مشوي × 1", EscPosAlign.Right, fontSize: 18f);
        doc.Line("Chicken Burger × 1", EscPosAlign.Left, fontSize: 18f);
        doc.Line("نص مختلط: طلب #42 — جاهز", EscPosAlign.Right, fontSize: 16f);
        doc.Separator();
        doc.Line("إذا ظهرت الحروف متصلة فالتشكيل يعمل.", EscPosAlign.Center, fontSize: 16f);
        doc.Cut();
        return doc.ToBytes();
    }

    private static void AppendPayload(EscPosDocument doc, object? payload)
    {
        if (payload is null)
        {
            doc.Line("(empty)", EscPosAlign.Left);
            return;
        }

        using var el = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        var root = el.RootElement;
        WriteJsonValue(doc, root, depth: 0);
    }

    private static void WriteJsonValue(EscPosDocument doc, JsonElement el, int depth)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in el.EnumerateObject())
                {
                    if (p.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                    {
                        doc.Line($"{p.Name}:", EscPosAlign.Right, fontSize: 15f, bold: true);
                        WriteJsonValue(doc, p.Value, depth + 1);
                    }
                    else
                    {
                        var val = JsonValueToString(p.Value);
                        var line = $"{p.Name}: {val}";
                        var align = Arabic.ContainsArabic(line) ? EscPosAlign.Right : EscPosAlign.Left;
                        doc.Line(line, align, fontSize: 15f);
                    }
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in el.EnumerateArray())
                    WriteJsonValue(doc, item, depth + 1);
                break;
            default:
                doc.Line(JsonValueToString(el), EscPosAlign.Left, fontSize: 15f);
                break;
        }
    }

    private static string JsonValueToString(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString() ?? "",
        JsonValueKind.Number => el.ToString(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "",
        _ => el.ToString(),
    };
}

/// <summary>Windows spooler transport — success = bytes accepted (transport_ack), not paper-out.</summary>
public static class SpoolerTransport
{
    public static void PrintRaw(string printerName, byte[] data, int copies)
    {
        copies = Math.Clamp(copies, 1, 5);
        for (var i = 0; i < copies; i++)
        {
            if (!RawPrinterHelper.SendBytesToPrinter(printerName, data))
                throw new InvalidOperationException($"SPOOLER_REJECTED:{printerName}");
        }
    }
}

/// <summary>Minimal raw printer send via Winspool.</summary>
internal static class RawPrinterHelper
{
    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 pDocInfo);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [System.Runtime.InteropServices.DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private struct DOC_INFO_1
    {
        public string pDocName;
        public string? pOutputFile;
        public string pDataType;
    }

    public static bool SendBytesToPrinter(string printerName, byte[] bytes)
    {
        if (!OpenPrinter(printerName, out var h, IntPtr.Zero))
            return false;
        try
        {
            var di = new DOC_INFO_1 { pDocName = "NIHA Print Job", pDataType = "RAW", pOutputFile = null };
            if (!StartDocPrinter(h, 1, ref di)) return false;
            try
            {
                if (!StartPagePrinter(h)) return false;
                var unmanaged = System.Runtime.InteropServices.Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    System.Runtime.InteropServices.Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    if (!WritePrinter(h, unmanaged, bytes.Length, out _))
                        return false;
                }
                finally
                {
                    System.Runtime.InteropServices.Marshal.FreeCoTaskMem(unmanaged);
                }
                EndPagePrinter(h);
            }
            finally
            {
                EndDocPrinter(h);
            }
            return true;
        }
        finally
        {
            ClosePrinter(h);
        }
    }
}
