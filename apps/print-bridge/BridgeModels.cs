using System.Text.Json.Serialization;

namespace Niha.PrintBridge;

/// <summary>One Supabase project connection (Production or Testing).</summary>
public sealed class BridgeConnection
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    /// <summary>production | testing | unknown</summary>
    public string Env { get; set; } = "unknown";
    public string SupabaseUrl { get; set; } = "";
    public string AnonKey { get; set; } = "";
    public string? BridgeToken { get; set; }
    public string? BridgeId { get; set; }
    public string? RestaurantName { get; set; }
    public string? RestaurantId { get; set; }
    public string? PrintCenterUrl { get; set; }
    public DateTimeOffset? LastHeartbeatAt { get; set; }
    public string? LastError { get; set; }
    /// <summary>Preferred connection for legacy summary fields (optional).</summary>
    public bool IsDefault { get; set; }

    [JsonIgnore]
    public bool IsPaired =>
        !string.IsNullOrWhiteSpace(BridgeToken) &&
        !string.IsNullOrWhiteSpace(SupabaseUrl) &&
        !string.IsNullOrWhiteSpace(AnonKey);

    public static string DetectEnv(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return "unknown";
        var u = url.ToLowerInvariant();
        if (u.Contains("xywgmolpnhimivwmsmpw", StringComparison.Ordinal)) return "testing";
        if (u.Contains("nzwgoavyrshuypkugvzc", StringComparison.Ordinal)) return "production";
        return "unknown";
    }

    public static bool UrlsMatch(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;
        try
        {
            var ua = new Uri(a.TrimEnd('/') + "/");
            var ub = new Uri(b.TrimEnd('/') + "/");
            return string.Equals(ua.Host, ub.Host, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return string.Equals(a.TrimEnd('/'), b.TrimEnd('/'), StringComparison.OrdinalIgnoreCase);
        }
    }
}

/// <summary>Local Bridge config — never stores service_role. Supports dual env (Prod + Testing).</summary>
public sealed class BridgeConfig
{
    /// <summary>Paired cloud connections (Production and/or Testing).</summary>
    public List<BridgeConnection> Connections { get; set; } = new();

    // Legacy single-connection fields — kept for upgrade + MainForm summary.
    // ConfigStore.Normalize migrates them into Connections and keeps them synced.
    public string SupabaseUrl { get; set; } = "";
    public string AnonKey { get; set; } = "";
    public string? BridgeToken { get; set; }
    public string? BridgeId { get; set; }
    public string? RestaurantName { get; set; }
    public string? RestaurantId { get; set; }
    public string? PrintCenterUrl { get; set; }
    /// <summary>Start Bridge when Windows logs in (default ON for POS PCs).</summary>
    public bool StartWithWindows { get; set; } = true;
    /// <summary>Once true, we no longer overwrite StartWithWindows on upgrade defaults.</summary>
    public bool StartWithWindowsInitialized { get; set; }
    /// <summary>When true, Bridge checks Print Center manifest and can self-update.</summary>
    public bool AutoUpdate { get; set; } = true;
    public int PollMs { get; set; } = 1500;
    public string? LastPrintSummary { get; set; }
    public DateTimeOffset? LastPrintAt { get; set; }
    public bool? LastPrintOk { get; set; }
    public DateTimeOffset? LastHeartbeatAt { get; set; }
    /// <summary>When false (default), hide PDF/OneNote/XPS-style virtual printers.</summary>
    public bool ShowVirtualPrinters { get; set; }

    public IEnumerable<BridgeConnection> PairedConnections() =>
        Connections.Where(c => c.IsPaired);

    public BridgeConnection? FindByUrl(string? url) =>
        Connections.FirstOrDefault(c => BridgeConnection.UrlsMatch(c.SupabaseUrl, url));

    /// <summary>Prefer explicit default, then Production, else first paired.</summary>
    public BridgeConnection? PrimaryConnection() =>
        PairedConnections().FirstOrDefault(c => c.IsDefault)
        ?? PairedConnections().FirstOrDefault(c =>
            string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase))
        ?? PairedConnections().FirstOrDefault()
        ?? Connections.FirstOrDefault();

    public BridgeConnection? FindById(string? id) =>
        string.IsNullOrWhiteSpace(id)
            ? null
            : Connections.FirstOrDefault(c =>
                string.Equals(c.Id, id, StringComparison.OrdinalIgnoreCase));
}

public sealed class ClaimedJob
{
    [JsonPropertyName("id")] public Guid Id { get; set; }
    [JsonPropertyName("reference")] public string? Reference { get; set; }
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("payload")] public object? Payload { get; set; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; set; }
    [JsonPropertyName("printer")] public PrinterInfo? Printer { get; set; }
    [JsonPropertyName("template_body")] public object? TemplateBody { get; set; }
}

public sealed class PrinterInfo
{
    [JsonPropertyName("id")] public Guid Id { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("connection")] public string? Connection { get; set; }
    [JsonPropertyName("address")] public object? Address { get; set; }
    [JsonPropertyName("paper_width_mm")] public int PaperWidthMm { get; set; } = 80;
    [JsonPropertyName("encoding")] public string? Encoding { get; set; }
    [JsonPropertyName("auto_cut")] public bool AutoCut { get; set; } = true;
    [JsonPropertyName("open_cash_drawer")] public bool OpenCashDrawer { get; set; }
    [JsonPropertyName("default_copies")] public int DefaultCopies { get; set; } = 1;
}

public enum BridgeLinkState
{
    NotPaired,
    Connecting,
    Connected,
    Disconnected,
}
