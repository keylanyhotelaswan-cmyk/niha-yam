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
        Normalize(cfg);
        return cfg;
    }

    public static void Save(BridgeConfig cfg)
    {
        Normalize(cfg);
        Directory.CreateDirectory(Dir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>
    /// Migrate legacy single-connection config into Connections and keep summary fields in sync.
    /// Pairing a second env (Testing) adds a connection — it never wipes Production.
    /// </summary>
    public static void Normalize(BridgeConfig cfg)
    {
        cfg.Connections ??= new List<BridgeConnection>();

        if (cfg.Connections.Count == 0 &&
            (!string.IsNullOrWhiteSpace(cfg.BridgeToken) || !string.IsNullOrWhiteSpace(cfg.SupabaseUrl)))
        {
            cfg.Connections.Add(new BridgeConnection
            {
                Env = BridgeConnection.DetectEnv(cfg.SupabaseUrl),
                SupabaseUrl = cfg.SupabaseUrl ?? "",
                AnonKey = cfg.AnonKey ?? "",
                BridgeToken = cfg.BridgeToken,
                BridgeId = cfg.BridgeId,
                RestaurantName = cfg.RestaurantName,
                RestaurantId = cfg.RestaurantId,
                PrintCenterUrl = cfg.PrintCenterUrl,
                LastHeartbeatAt = cfg.LastHeartbeatAt,
            });
        }

        foreach (var c in cfg.Connections)
        {
            if (string.IsNullOrWhiteSpace(c.Env) || c.Env == "unknown")
                c.Env = BridgeConnection.DetectEnv(c.SupabaseUrl);
        }

        // Drop empty shells
        cfg.Connections = cfg.Connections
            .Where(c => !string.IsNullOrWhiteSpace(c.SupabaseUrl) || !string.IsNullOrWhiteSpace(c.BridgeToken))
            .ToList();

        SyncLegacyFields(cfg);
    }

    public static void SyncLegacyFields(BridgeConfig cfg)
    {
        var primary = cfg.PrimaryConnection();
        if (primary is null) return;
        cfg.SupabaseUrl = primary.SupabaseUrl;
        cfg.AnonKey = primary.AnonKey;
        cfg.BridgeToken = primary.BridgeToken;
        cfg.BridgeId = primary.BridgeId;
        cfg.RestaurantName = primary.RestaurantName;
        cfg.RestaurantId = primary.RestaurantId;
        cfg.PrintCenterUrl = primary.PrintCenterUrl;
        cfg.LastHeartbeatAt = cfg.PairedConnections()
            .Select(c => c.LastHeartbeatAt)
            .Where(t => t is not null)
            .DefaultIfEmpty(null)
            .Max();
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
    private DateTimeOffset _lastEmptyClaimDiagAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastConfigSaveAt = DateTimeOffset.MinValue;
    private IReadOnlyList<WindowsPrinterInfo>? _printerCache;
    private DateTimeOffset _printerCacheAt = DateTimeOffset.MinValue;
    private static readonly TimeSpan PrinterCacheTtl = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan ConfigSaveMinInterval = TimeSpan.FromMinutes(1);

    /// <summary>Last claim/diag line for Advanced diagnostics (support).</summary>
    public string LastClaimSummary { get; private set; } = Ar.None;

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
                ConfigStore.Normalize(_cfg);
                var paired = _cfg.PairedConnections().ToList();
                if (paired.Count == 0)
                {
                    SetState(BridgeLinkState.NotPaired);
                    await Task.Delay(_cfg.PollMs, ct);
                    continue;
                }

                SetState(BridgeLinkState.Connecting);
                var anyConnected = false;
                var printers = GetCachedPrinters();

                foreach (var conn in paired)
                {
                    var envTag = conn.Env;
                    var api = new SupabaseBridgeApi(conn);
                    try
                    {
                        await api.HeartbeatAsync(restarted, ct);
                        conn.LastHeartbeatAt = DateTimeOffset.Now;
                        conn.LastError = null;
                        anyConnected = true;

                        try
                        {
                            await api.ReportPrintersAsync(printers, ct);
                        }
                        catch (Exception ex)
                        {
                            _log.Error($"[{envTag}] report printers: {ex.Message}");
                        }

                        await FlushOfflineAsync(api, conn.SupabaseUrl, ct);
                        var jobs = await api.ClaimAsync(10, ct);
                        var claimLine =
                            $"[{envTag}] poll claim: found={jobs.Count} bridgeId={conn.BridgeId ?? "?"} " +
                            $"tokenPrefix={(conn.BridgeToken is { Length: >= 8 } t ? t[..8] : "?")}";
                        _log.Info(claimLine);
                        LastClaimSummary = $"{envTag}: found={jobs.Count}";

                        if (jobs.Count == 0)
                        {
                            if (DateTimeOffset.UtcNow - _lastEmptyClaimDiagAt > TimeSpan.FromSeconds(30))
                            {
                                _lastEmptyClaimDiagAt = DateTimeOffset.UtcNow;
                                try
                                {
                                    var diag = await api.DiagnoseClaimAsync(ct);
                                    _log.Info($"[{envTag}] claim_diag: {diag}");
                                    var shortDiag = diag.Length > 160 ? diag[..160] + "…" : diag;
                                    LastClaimSummary = $"{envTag}: found=0 · {shortDiag}";
                                }
                                catch (Exception dex)
                                {
                                    _log.Error($"[{envTag}] claim_diag: {dex.Message}");
                                }
                            }
                        }
                        else
                        {
                            foreach (var j in jobs)
                                _log.Info(
                                    $"[{envTag}] claimed job {j.Reference ?? j.Id.ToString()} " +
                                    $"printerId={j.Printer?.Id} win={ResolvePrinterName(j)}");
                            LastClaimSummary =
                                $"{envTag}: found={jobs.Count} · {jobs[0].Reference ?? jobs[0].Id.ToString()}";
                        }

                        foreach (var job in jobs)
                            await ProcessJobAsync(api, conn.SupabaseUrl, job, ct);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        conn.LastError = ex.Message;
                        _log.Error($"[{envTag}] loop: {ex.Message}");
                    }
                }

                restarted = false;
                ConfigStore.SyncLegacyFields(_cfg);
                MaybeSaveConfig();

                SetState(anyConnected ? BridgeLinkState.Connected : BridgeLinkState.Disconnected);
            }
            catch (OperationCanceledException) { break; }

            try { await Task.Delay(_cfg.PollMs, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private IReadOnlyList<WindowsPrinterInfo> GetCachedPrinters()
    {
        if (_printerCache is not null &&
            DateTimeOffset.UtcNow - _printerCacheAt < PrinterCacheTtl)
            return _printerCache;

        _printerCache = WindowsPrinterInventory.Discover();
        _printerCacheAt = DateTimeOffset.UtcNow;
        return _printerCache;
    }

    private void MaybeSaveConfig()
    {
        if (DateTimeOffset.UtcNow - _lastConfigSaveAt < ConfigSaveMinInterval)
            return;
        try
        {
            ConfigStore.Save(_cfg);
            _lastConfigSaveAt = DateTimeOffset.UtcNow;
        }
        catch
        {
            /* ignore disk races */
        }
    }

    private async Task FlushOfflineAsync(SupabaseBridgeApi api, string connectionKey, CancellationToken ct)
    {
        foreach (var (id, ok, code, msg, delivery) in _offline.ListPending(connectionKey))
        {
            try
            {
                await api.ReportAsync(id, ok, code, msg, delivery, ct);
                _offline.Remove(id, connectionKey);
            }
            catch (Exception ex)
            {
                _log.Error($"flush {id}: {ex.Message}");
                break;
            }
        }
    }

    private async Task ProcessJobAsync(
        SupabaseBridgeApi api,
        string connectionKey,
        ClaimedJob job,
        CancellationToken ct)
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
                _offline.EnqueueReport(job.Id, false, "TTL_EXPIRED", ex.Message, "transport_ack", connectionKey);
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
                _offline.EnqueueReport(job.Id, true, null, null, delivery, connectionKey);
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
                _offline.EnqueueReport(job.Id, false, "PRINT_FAILED", ex.Message, "transport_ack", connectionKey);
            }
            PrintFinished?.Invoke(false, ex.Message);
        }
    }

    private static string ResolvePrinterName(ClaimedJob job)
    {
        string? wanted = null;

        if (job.Printer?.Address is JsonElement el &&
            el.ValueKind == JsonValueKind.Object)
        {
            if (el.TryGetProperty("windows_printer_name", out var wp1))
                wanted = wp1.GetString();
            if (string.IsNullOrWhiteSpace(wanted) &&
                el.TryGetProperty("windows_printer", out var wp2))
                wanted = wp2.GetString();
        }

        if (string.IsNullOrWhiteSpace(wanted))
        {
            try
            {
                if (job.Payload is JsonElement payload &&
                    payload.ValueKind == JsonValueKind.Object &&
                    payload.TryGetProperty("windows_printer_name", out var fromPayload))
                    wanted = fromPayload.GetString();
            }
            catch { /* ignore */ }
        }

        if (string.IsNullOrWhiteSpace(wanted))
            wanted = job.Printer?.Name;

        // Never hard-fail on a stale Windows queue name (copy 1 / USB / new PC).
        return WindowsPrinterInventory.ResolveLocalName(wanted);
    }
}
