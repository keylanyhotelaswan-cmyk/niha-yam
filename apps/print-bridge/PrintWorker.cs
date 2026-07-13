using System.Text.Json;

namespace Niha.PrintBridge;

public sealed class BridgeLogger
{
    private readonly string _path;
    private readonly object _gate = new();

    public BridgeLogger(string path)
    {
        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public void Info(string msg) => Write("INFO", msg);
    public void Error(string msg) => Write("ERROR", msg);

    private void Write(string level, string msg)
    {
        var line = $"{DateTimeOffset.Now:O} [{level}] {msg}{Environment.NewLine}";
        lock (_gate)
        {
            File.AppendAllText(_path, line);
        }
    }
}

public static class ConfigStore
{
    public static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NihaPrintBridge");

    public static string ConfigPath => Path.Combine(Dir, "config.json");
    public static string DbPath => Path.Combine(Dir, "offline.db");
    public static string LogPath => Path.Combine(Dir, "bridge.log");

    public static BridgeConfig Load()
    {
        Directory.CreateDirectory(Dir);
        var cfg = File.Exists(ConfigPath)
            ? JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(ConfigPath)) ?? new BridgeConfig()
            : new BridgeConfig();

        // Prefill from package defaults (shipped next to exe by Print Center download).
        ApplyDefaults(cfg);
        return cfg;
    }

    public static void Save(BridgeConfig cfg)
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static void ApplyDefaults(BridgeConfig cfg)
    {
        try
        {
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath)
                ?? AppContext.BaseDirectory;
            var path = Path.Combine(exeDir, "bridge-defaults.json");
            if (!File.Exists(path))
                path = Path.Combine(AppContext.BaseDirectory, "bridge-defaults.json");
            if (!File.Exists(path)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            if (string.IsNullOrWhiteSpace(cfg.SupabaseUrl) &&
                root.TryGetProperty("supabaseUrl", out var url))
                cfg.SupabaseUrl = url.GetString() ?? "";
            if (string.IsNullOrWhiteSpace(cfg.AnonKey) &&
                root.TryGetProperty("anonKey", out var key))
                cfg.AnonKey = key.GetString() ?? "";
            if (string.IsNullOrWhiteSpace(cfg.PrintCenterUrl) &&
                root.TryGetProperty("printCenterUrl", out var pc))
                cfg.PrintCenterUrl = pc.GetString();
            if (string.IsNullOrWhiteSpace(cfg.RestaurantName) &&
                root.TryGetProperty("restaurantName", out var rn))
                cfg.RestaurantName = rn.GetString();
        }
        catch
        {
            // Defaults are optional; pairing can still succeed via QR payload.
        }
    }
}

/// <summary>Claim → Render → Print → Report. Skips expired jobs (BP-12). Reports transport_ack (BP-13).</summary>
public sealed class PrintWorker
{
    private readonly BridgeConfig _cfg;
    private readonly BridgeLogger _log;
    private readonly OfflineStore _offline;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public event Action<BridgeLinkState>? StateChanged;
    public event Action<bool, string>? PrintFinished;

    public PrintWorker(BridgeConfig cfg, BridgeLogger log, OfflineStore offline)
    {
        _cfg = cfg;
        _log = log;
        _offline = offline;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => LoopAsync(_cts.Token));
    }

    public async Task StopAsync()
    {
        if (_cts is null) return;
        _cts.Cancel();
        if (_loop is not null)
        {
            try { await _loop; } catch { /* ignore */ }
        }
    }

    private void SetState(BridgeLinkState state) => StateChanged?.Invoke(state);

    private async Task LoopAsync(CancellationToken ct)
    {
        var restarted = true;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_cfg.BridgeToken) ||
                    string.IsNullOrWhiteSpace(_cfg.SupabaseUrl) ||
                    string.IsNullOrWhiteSpace(_cfg.AnonKey))
                {
                    SetState(BridgeLinkState.NotPaired);
                    await Task.Delay(_cfg.PollMs, ct);
                    continue;
                }

                SetState(BridgeLinkState.Connecting);
                var api = new SupabaseBridgeApi(_cfg);
                try
                {
                    await api.HeartbeatAsync(restarted, ct);
                    restarted = false;
                    _cfg.LastHeartbeatAt = DateTimeOffset.Now;
                    SetState(BridgeLinkState.Connected);

                    // Report Windows printer inventory to Print Center (every loop)
                    try
                    {
                        await api.ReportPrintersAsync(DiscoverWindowsPrinters(), ct);
                    }
                    catch (Exception ex)
                    {
                        _log.Error($"report printers: {ex.Message}");
                    }

                    await FlushOfflineAsync(api, ct);
                    var jobs = await api.ClaimAsync(10, ct);
                    foreach (var job in jobs)
                        await ProcessJobAsync(api, job, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _log.Error($"loop: {ex.Message}");
                    SetState(BridgeLinkState.Disconnected);
                }
            }
            catch (OperationCanceledException) { break; }

            try { await Task.Delay(_cfg.PollMs, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task FlushOfflineAsync(SupabaseBridgeApi api, CancellationToken ct)
    {
        foreach (var (id, ok, code, msg, delivery) in _offline.ListPending())
        {
            try
            {
                await api.ReportAsync(id, ok, code, msg, delivery, ct);
                _offline.Remove(id);
            }
            catch (Exception ex)
            {
                _log.Error($"flush {id}: {ex.Message}");
                break;
            }
        }
    }

    private async Task ProcessJobAsync(SupabaseBridgeApi api, ClaimedJob job, CancellationToken ct)
    {
        // BP-12: never auto-print past TTL
        if (job.ExpiresAt is { } exp && exp < DateTimeOffset.UtcNow)
        {
            _log.Info($"skip expired job {job.Id}");
            try
            {
                await api.ReportAsync(job.Id, false, "TTL_EXPIRED", "Job expired before print", "transport_ack", ct);
            }
            catch (Exception ex)
            {
                _offline.EnqueueReport(job.Id, false, "TTL_EXPIRED", ex.Message, "transport_ack");
            }
            PrintFinished?.Invoke(false, $"{job.Reference ?? job.Id.ToString()} · TTL");
            return;
        }

        try
        {
            var bytes = EscPosRenderer.Render(job);
            var printerName = ResolvePrinterName(job);
            var copies = job.Printer?.DefaultCopies ?? 1;
            SpoolerTransport.PrintRaw(printerName, bytes, copies);
            // BP-13: spooler accept only — not paper-out
            const string delivery = "transport_ack";
            try
            {
                await api.ReportAsync(job.Id, true, null, null, delivery, ct);
            }
            catch
            {
                _offline.EnqueueReport(job.Id, true, null, null, delivery);
            }
            _log.Info($"printed job {job.Id} → {printerName} ({delivery})");
            PrintFinished?.Invoke(true, $"{job.Reference ?? "job"} → {printerName}");
        }
        catch (Exception ex)
        {
            _log.Error($"print {job.Id}: {ex.Message}");
            try
            {
                await api.ReportAsync(job.Id, false, "PRINT_FAILED", ex.Message, "transport_ack", ct);
            }
            catch
            {
                _offline.EnqueueReport(job.Id, false, "PRINT_FAILED", ex.Message, "transport_ack");
            }
            PrintFinished?.Invoke(false, ex.Message);
        }
    }

    private static string ResolvePrinterName(ClaimedJob job)
    {
        // Prefer Windows printer name from address.jsonb
        if (job.Printer?.Address is JsonElement el &&
            el.ValueKind == JsonValueKind.Object)
        {
            if (el.TryGetProperty("windows_printer_name", out var wp1))
            {
                var name = wp1.GetString();
                if (!string.IsNullOrWhiteSpace(name)) return name!;
            }
            if (el.TryGetProperty("windows_printer", out var wp2))
            {
                var name = wp2.GetString();
                if (!string.IsNullOrWhiteSpace(name)) return name!;
            }
        }

        // Fallback: payload from enqueue_test_print
        try
        {
            if (job.Payload is JsonElement payload &&
                payload.ValueKind == JsonValueKind.Object &&
                payload.TryGetProperty("windows_printer_name", out var fromPayload))
            {
                var name = fromPayload.GetString();
                if (!string.IsNullOrWhiteSpace(name)) return name!;
            }
        }
        catch { /* ignore */ }

        return job.Printer?.Name ?? "Microsoft Print to PDF";
    }

    private static List<(string Name, bool IsVirtual)> DiscoverWindowsPrinters()
    {
        var list = new List<(string, bool)>();
        try
        {
            foreach (string name in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                list.Add((name, PrinterFilter.IsVirtual(name)));
        }
        catch
        {
            /* ignore */
        }
        return list;
    }
}
