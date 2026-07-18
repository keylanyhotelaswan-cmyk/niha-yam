using System.Drawing.Printing;
using System.Text;

namespace Niha.PrintBridge;

/// <summary>Plain-text diagnostics for support — copy/paste friendly.</summary>
public static class DiagnosticsReport
{
    public static string Build(BridgeConfig cfg, PrintWorker worker, BridgeLinkState state)
    {
        ConfigStore.Normalize(cfg);
        var sb = new StringBuilder();
        var ver = typeof(DiagnosticsReport).Assembly.GetName().Version?.ToString(3) ?? "?";
        var install = Path.GetDirectoryName(Application.ExecutablePath) ?? AppContext.BaseDirectory;

        sb.AppendLine($"NIHA Print Bridge {ver}");
        sb.AppendLine($"Status: {StatusEn(state)}");
        sb.AppendLine($"Activity: {worker.Activity}");
        sb.AppendLine($"LastStage: {PrintStageLabels.En(worker.LastStage)}");
        sb.AppendLine($"LastStageDetail: {worker.LastStageDetail}");
        sb.AppendLine($"Device: {Environment.MachineName}");
        sb.AppendLine($"User: {Environment.UserName}");
        sb.AppendLine();

        sb.AppendLine("Connections:");
        var conns = cfg.Connections
            .OrderBy(c =>
                string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase) ? 0 :
                string.Equals(c.Env, "testing", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .ToList();
        if (conns.Count == 0)
        {
            sb.AppendLine("- (none)");
        }
        else
        {
            foreach (var c in conns)
            {
                var d = worker.GetConnDiag(c);
                var online = d.LinkOk &&
                    c.LastHeartbeatAt is { } hb &&
                    (DateTimeOffset.Now - hb).TotalSeconds < 90 &&
                    string.IsNullOrWhiteSpace(c.LastError);
                var mark = online ? "✓" : "✗";
                var env = c.Env switch
                {
                    "production" => "Production",
                    "testing" => "Testing",
                    _ => c.Env ?? "unknown",
                };
                var name = string.IsNullOrWhiteSpace(c.RestaurantName) ? "" : $" ({c.RestaurantName})";
                var poll = d.LastPollAt is { } t
                    ? t.ToLocalTime().ToString("HH:mm:ss")
                    : "-";
                sb.AppendLine($"- {env}{name} {mark}{(c.IsDefault ? " [default]" : "")}");
                sb.AppendLine($"  Last Poll: {poll}");
                sb.AppendLine($"  Claim: {d.LastClaimCount} · {d.ClaimReason ?? "-"}");
                sb.AppendLine($"  Received total: {d.JobsReceivedTotal} · Printed total: {d.JobsPrintedTotal}");
                sb.AppendLine($"  Print: {(d.LastPrintOk == true ? "OK" : d.LastPrintOk == false ? "Failed" : "-")} · {d.PrintReason ?? "-"}");
                sb.AppendLine($"  Last error: {d.LastError ?? c.LastError ?? "-"}");
                sb.AppendLine($"  Pipeline: {d.PipelineSummary}");
                if (!string.IsNullOrWhiteSpace(c.BridgeId))
                    sb.AppendLine($"  bridgeId: {c.BridgeId}");
                if (!string.IsNullOrWhiteSpace(c.LastError))
                    sb.AppendLine($"  error: {c.LastError}");
            }
        }

        sb.AppendLine();
        sb.AppendLine("Detected Printers:");
        var printers = ListPrinterNames(cfg.ShowVirtualPrinters);
        if (printers.Count == 0)
            sb.AppendLine("- (none)");
        else
            foreach (var p in printers)
                sb.AppendLine($"- {p}");

        sb.AppendLine();
        sb.AppendLine("Last Claim:");
        sb.AppendLine(string.IsNullOrWhiteSpace(worker.LastClaimSummary)
            ? "-"
            : worker.LastClaimSummary);

        sb.AppendLine();
        sb.AppendLine("Last Print:");
        if (cfg.LastPrintAt is { } lp)
            sb.AppendLine($"{(cfg.LastPrintOk == true ? "OK" : "FAIL")} · {cfg.LastPrintSummary} · {lp.ToLocalTime():yyyy-MM-dd HH:mm:ss}");
        else
            sb.AppendLine("-");

        sb.AppendLine();
        sb.AppendLine("Config:");
        sb.AppendLine(ConfigStore.Dir);
        sb.AppendLine();
        sb.AppendLine("Install:");
        sb.AppendLine(install);

        return sb.ToString().TrimEnd() + Environment.NewLine;
    }

    private static string StatusEn(BridgeLinkState state) => state switch
    {
        BridgeLinkState.Connected => "Connected",
        BridgeLinkState.Connecting => "Connecting",
        BridgeLinkState.NotPaired => "NotPaired",
        BridgeLinkState.Disconnected => "Disconnected",
        _ => state.ToString(),
    };

    private static List<string> ListPrinterNames(bool showVirtual)
    {
        try
        {
            var fromInv = WindowsPrinterInventory.Discover()
                .Where(p => showVirtual || !p.IsVirtual)
                .Select(p => p.Name)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (fromInv.Count > 0) return fromInv!;
        }
        catch { /* fall through */ }

        return PrinterSettings.InstalledPrinters
            .Cast<string>()
            .Where(n => showVirtual || !PrinterFilter.IsVirtual(n))
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
