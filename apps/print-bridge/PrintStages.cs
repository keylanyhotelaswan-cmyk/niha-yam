namespace Niha.PrintBridge;

/// <summary>Precise print pipeline stage for support diagnostics.</summary>
public enum PrintStage
{
    Idle,
    PollStart,
    HeartbeatOk,
    ClaimCall,
    ClaimEmpty,
    ClaimReceived,
    JobStart,
    TtlExpired,
    RenderStart,
    RenderOk,
    PrinterResolve,
    SpoolerOpen,
    SpoolerStartDoc,
    SpoolerWrite,
    SpoolerOk,
    ReportSuccess,
    ReportFailure,
    Failed,
    Done,
}

/// <summary>Operator-visible activity (separate from link Connected/Disconnected).</summary>
public enum BridgeActivity
{
    Idle,
    WaitingForJobs,
    Claiming,
    ProcessingJob,
    Rendering,
    Printing,
    Reporting,
}

/// <summary>Per-connection runtime diagnostics (not persisted).</summary>
public sealed class ConnectionPollDiag
{
    public DateTimeOffset? LastPollAt { get; set; }
    public bool LinkOk { get; set; }
    public int LastClaimCount { get; set; }
    public string? ClaimReason { get; set; }
    public string? LastJobRef { get; set; }
    public bool? LastPrintOk { get; set; }
    public string? PrintReason { get; set; }
    public PrintStage LastStage { get; set; } = PrintStage.Idle;
    public string LastStageDetail { get; set; } = "";

    /// <summary>Short pipeline: Link → Claim → Match → Print → Success (or where it stopped).</summary>
    public string PipelineSummary
    {
        get
        {
            if (!LinkOk) return "Link ✗";
            if (LastClaimCount <= 0)
                return $"Link ✓ → Claim 0 · {ClaimReason ?? "empty/gated"}";
            if (LastPrintOk == true)
                return $"Link ✓ → Claim {LastClaimCount} → Print ✓ → Success";
            if (LastPrintOk == false)
                return $"Link ✓ → Claim {LastClaimCount} → Print ✗ · {PrintReason ?? PrintStageLabels.En(LastStage)}";
            return $"Link ✓ → Claim {LastClaimCount} → …";
        }
    }
}

public static class PrintStageLabels
{
    public static string En(PrintStage s) => s switch
    {
        PrintStage.Idle => "idle",
        PrintStage.PollStart => "poll_start",
        PrintStage.HeartbeatOk => "heartbeat_ok",
        PrintStage.ClaimCall => "claim_call",
        PrintStage.ClaimEmpty => "claim_empty",
        PrintStage.ClaimReceived => "claim_received",
        PrintStage.JobStart => "job_start",
        PrintStage.TtlExpired => "ttl_expired",
        PrintStage.RenderStart => "render_start",
        PrintStage.RenderOk => "render_ok",
        PrintStage.PrinterResolve => "printer_resolve",
        PrintStage.SpoolerOpen => "spooler_open",
        PrintStage.SpoolerStartDoc => "spooler_start_doc",
        PrintStage.SpoolerWrite => "spooler_write",
        PrintStage.SpoolerOk => "spooler_ok",
        PrintStage.ReportSuccess => "report_success",
        PrintStage.ReportFailure => "report_failure",
        PrintStage.Failed => "failed",
        PrintStage.Done => "done",
        _ => s.ToString(),
    };
}
