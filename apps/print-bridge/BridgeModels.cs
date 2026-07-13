using System.Text.Json.Serialization;

namespace Niha.PrintBridge;

/// <summary>Local Bridge config — never stores service_role.</summary>
public sealed class BridgeConfig
{
    public string SupabaseUrl { get; set; } = "";
    public string AnonKey { get; set; } = "";
    public string? BridgeToken { get; set; }
    public string? BridgeId { get; set; }
    public string? RestaurantName { get; set; }
    public string? RestaurantId { get; set; }
    public string? PrintCenterUrl { get; set; }
    public bool StartWithWindows { get; set; }
    public int PollMs { get; set; } = 1500;
    public string? LastPrintSummary { get; set; }
    public DateTimeOffset? LastPrintAt { get; set; }
    public bool? LastPrintOk { get; set; }
    public DateTimeOffset? LastHeartbeatAt { get; set; }
    /// <summary>When false (default), hide PDF/OneNote/XPS-style virtual printers.</summary>
    public bool ShowVirtualPrinters { get; set; }
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
