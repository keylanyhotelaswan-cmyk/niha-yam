using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Clear test-environment banner on receipts so Testing never looks like live ops.</summary>
internal static class TestEnvBanner
{
    public static readonly string[] DefaultLines =
    [
        "====================",
        "بيئة اختبار",
        "نسخة اختبار",
        "غير صالحة للتشغيل",
        "====================",
    ];

    public static bool IsTestEnv(ClaimedJob job)
    {
        try
        {
            JsonElement root;
            if (job.Payload is JsonElement el)
                root = el;
            else if (job.Payload is not null)
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(job.Payload));
                root = doc.RootElement.Clone();
            }
            else
                return false;

            if (root.ValueKind != JsonValueKind.Object) return false;
            if (root.TryGetProperty("test_env", out var te) && te.ValueKind == JsonValueKind.True)
                return true;
            return false;
        }
        catch
        {
            return false;
        }
    }

    public static void Write(EscPosDocument doc, ClaimedJob job)
    {
        if (!IsTestEnv(job)) return;

        string[] lines = DefaultLines;
        try
        {
            if (job.Payload is JsonElement root &&
                root.ValueKind == JsonValueKind.Object &&
                root.TryGetProperty("test_env_banner", out var arr) &&
                arr.ValueKind == JsonValueKind.Array)
            {
                var list = new List<string>();
                foreach (var item in arr.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var s = item.GetString();
                        if (!string.IsNullOrWhiteSpace(s)) list.Add(s!);
                    }
                }
                if (list.Count > 0) lines = list.ToArray();
            }
        }
        catch
        {
            lines = DefaultLines;
        }

        foreach (var line in lines)
            doc.Line(line, EscPosAlign.Center, fontSize: 16f, bold: true);
        doc.Feed(1);
    }
}
