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
        if (primary is null)
        {
            cfg.BridgeToken = null;
            cfg.BridgeId = null;
            cfg.RestaurantName = null;
            cfg.RestaurantId = null;
            cfg.LastHeartbeatAt = null;
            return;
        }
        cfg.SupabaseUrl = primary.SupabaseUrl;
        cfg.AnonKey = primary.AnonKey;
        cfg.BridgeToken = primary.BridgeToken;
        cfg.BridgeId = primary.BridgeId;
        cfg.RestaurantName = primary.RestaurantName;
        cfg.RestaurantId = primary.RestaurantId;
        cfg.PrintCenterUrl = primary.PrintCenterUrl ?? cfg.PrintCenterUrl;
        cfg.LastHeartbeatAt = cfg.PairedConnections()
            .Select(c => c.LastHeartbeatAt)
            .Where(t => t is not null)
            .DefaultIfEmpty(null)
            .Max();
    }

    /// <summary>Remove all paired cloud connections — keeps autostart/update/printer prefs.</summary>
    public static void ClearConnectionsOnly(BridgeConfig cfg)
    {
        cfg.Connections = new List<BridgeConnection>();
        cfg.BridgeToken = null;
        cfg.BridgeId = null;
        cfg.RestaurantName = null;
        cfg.RestaurantId = null;
        cfg.LastHeartbeatAt = null;
        cfg.LastPrintSummary = null;
        cfg.LastPrintAt = null;
        cfg.LastPrintOk = null;
        // Leave PrintCenterUrl / AutoUpdate / StartWithWindows / ShowVirtualPrinters / PollMs.
        // Clear cloud endpoints so next pair uses QR/token or bridge-defaults.json.
        cfg.SupabaseUrl = "";
        cfg.AnonKey = "";
        Save(cfg);
    }

    public static void RemoveConnection(BridgeConfig cfg, string connectionId)
    {
        Normalize(cfg);
        cfg.Connections.RemoveAll(c =>
            string.Equals(c.Id, connectionId, StringComparison.OrdinalIgnoreCase));
        if (!cfg.Connections.Any(c => c.IsDefault) && cfg.Connections.Count > 0)
        {
            var prefer = cfg.Connections.FirstOrDefault(c =>
                string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase))
                ?? cfg.Connections[0];
            prefer.IsDefault = true;
        }
        SyncLegacyFields(cfg);
        Save(cfg);
    }

    public static void SetDefaultConnection(BridgeConfig cfg, string connectionId)
    {
        Normalize(cfg);
        foreach (var c in cfg.Connections)
            c.IsDefault = string.Equals(c.Id, connectionId, StringComparison.OrdinalIgnoreCase);
        SyncLegacyFields(cfg);
        Save(cfg);
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

    /// <summary>Operator-visible print activity (Waiting / Printing…).</summary>
    public BridgeActivity Activity { get; private set; } = BridgeActivity.Idle;

    /// <summary>Last precise pipeline stage + detail for support.</summary>
    public PrintStage LastStage { get; private set; } = PrintStage.Idle;
    public string LastStageDetail { get; private set; } = "";

    private readonly Dictionary<string, ConnectionPollDiag> _connDiags = new(StringComparer.OrdinalIgnoreCase);
    private bool _linkEverConnected;

    public event Action<BridgeLinkState>? StateChanged;
    public event Action? ActivityChanged;
    public event Action<bool, string>? PrintFinished;

    public ConnectionPollDiag GetConnDiag(BridgeConnection conn)
    {
        var key = ConnKey(conn);
        if (!_connDiags.TryGetValue(key, out var d))
        {
            d = new ConnectionPollDiag();
            _connDiags[key] = d;
        }
        return d;
    }

    public IReadOnlyDictionary<string, ConnectionPollDiag> AllConnDiags => _connDiags;

    private static string ConnKey(BridgeConnection conn) =>
        !string.IsNullOrWhiteSpace(conn.Id) ? conn.Id : conn.SupabaseUrl;

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

    private void SetActivity(BridgeActivity activity)
    {
        if (Activity == activity) return;
        Activity = activity;
        ActivityChanged?.Invoke();
    }

    private void SetStage(PrintStage stage, string detail, string? env = null)
    {
        LastStage = stage;
        LastStageDetail = string.IsNullOrWhiteSpace(env) ? detail : $"[{env}] {detail}";
        var tag = PrintStageLabels.En(stage);
        _log.Info($"[stage={tag}] {LastStageDetail}");
    }

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
                    _linkEverConnected = false;
                    SetActivity(BridgeActivity.Idle);
                    SetStage(PrintStage.Idle, "not paired");
                    SetState(BridgeLinkState.NotPaired);
                    await Task.Delay(_cfg.PollMs, ct);
                    continue;
                }

                // Do not flash "Connecting" every poll — only until first successful heartbeat.
                if (!_linkEverConnected)
                    SetState(BridgeLinkState.Connecting);

                SetStage(PrintStage.PollStart, $"envs={paired.Count}");
                var anyConnected = false;
                var anyJobsThisPoll = false;
                var printers = GetCachedPrinters();

                foreach (var conn in paired)
                {
                    var envTag = conn.Env;
                    var diag = GetConnDiag(conn);
                    diag.LastPollAt = DateTimeOffset.Now;
                    var api = new SupabaseBridgeApi(conn);
                    try
                    {
                        await api.HeartbeatAsync(restarted, ct);
                        conn.LastHeartbeatAt = DateTimeOffset.Now;
                        conn.LastError = null;
                        anyConnected = true;
                        diag.LinkOk = true;
                        SetStage(PrintStage.HeartbeatOk, $"bridgeId={conn.BridgeId ?? "?"}", envTag);
                        diag.LastStage = PrintStage.HeartbeatOk;

                        try
                        {
                            await api.ReportPrintersAsync(printers, ct);
                            _log.Info($"[{envTag}] report_printers: count={printers.Count}");
                        }
                        catch (Exception ex)
                        {
                            _log.Error($"[{envTag}] report_printers FAIL: {ex.Message}");
                        }

                        await FlushOfflineAsync(api, conn.SupabaseUrl, ct);

                        SetActivity(BridgeActivity.Claiming);
                        SetStage(PrintStage.ClaimCall, $"limit=10 bridgeId={conn.BridgeId ?? "?"}", envTag);
                        var jobs = await api.ClaimAsync(10, ct);
                        diag.LastClaimCount = jobs.Count;
                        LastClaimSummary = $"{envTag}: found={jobs.Count}";

                        if (jobs.Count == 0)
                        {
                            var reason = string.Equals(envTag, "testing", StringComparison.OrdinalIgnoreCase)
                                ? "empty queue or Testing session disabled"
                                : "empty queue or jobs routed elsewhere";
                            diag.ClaimReason = reason;
                            diag.LastStage = PrintStage.ClaimEmpty;
                            SetStage(
                                PrintStage.ClaimEmpty,
                                $"no jobs claimed ({reason}). bridgeId={conn.BridgeId ?? "?"}",
                                envTag);
                            if (DateTimeOffset.UtcNow - _lastEmptyClaimDiagAt > TimeSpan.FromSeconds(30))
                            {
                                _lastEmptyClaimDiagAt = DateTimeOffset.UtcNow;
                                try
                                {
                                    var claimDiag = await api.DiagnoseClaimAsync(ct);
                                    _log.Info($"[{envTag}] claim_diag: {claimDiag}");
                                    var parsed = SummarizeClaimDiag(claimDiag, envTag);
                                    diag.ClaimReason = parsed;
                                    var shortDiag = parsed.Length > 160 ? parsed[..160] + "…" : parsed;
                                    LastClaimSummary = $"{envTag}: found=0 · {shortDiag}";
                                    SetStage(PrintStage.ClaimEmpty, $"claim_diag: {shortDiag}", envTag);
                                }
                                catch (Exception dex)
                                {
                                    _log.Error($"[{envTag}] claim_diag FAIL: {dex.Message}");
                                }
                            }
                        }
                        else
                        {
                            anyJobsThisPoll = true;
                            diag.ClaimReason = $"claimed {jobs.Count}";
                            diag.LastJobRef = jobs[0].Reference ?? jobs[0].Id.ToString();
                            diag.LastStage = PrintStage.ClaimReceived;
                            SetStage(
                                PrintStage.ClaimReceived,
                                $"found={jobs.Count} first={diag.LastJobRef}",
                                envTag);
                            foreach (var j in jobs)
                            {
                                _log.Info(
                                    $"[{envTag}] CLAIM_OK ref={j.Reference ?? j.Id.ToString()} " +
                                    $"jobId={j.Id} printerId={j.Printer?.Id} " +
                                    $"printerName={j.Printer?.Name} " +
                                    $"wantedWin={PeekWantedPrinter(j)}");
                            }
                            LastClaimSummary =
                                $"{envTag}: found={jobs.Count} · {diag.LastJobRef}";
                        }

                        foreach (var job in jobs)
                            await ProcessJobAsync(api, conn, envTag, job, ct);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        conn.LastError = ex.Message;
                        diag.LinkOk = false;
                        diag.ClaimReason = ex.Message;
                        diag.LastStage = PrintStage.Failed;
                        diag.LastStageDetail = ex.Message;
                        SetStage(PrintStage.Failed, $"loop exception: {ex.Message}", envTag);
                        _log.Error($"[{envTag}] loop FAIL at stage={PrintStageLabels.En(LastStage)}: {ex.Message}");
                    }
                }

                restarted = false;
                ConfigStore.SyncLegacyFields(_cfg);
                MaybeSaveConfig();

                if (anyConnected)
                {
                    _linkEverConnected = true;
                    SetState(BridgeLinkState.Connected);
                    if (!anyJobsThisPoll)
                        SetActivity(BridgeActivity.WaitingForJobs);
                }
                else
                {
                    _linkEverConnected = false;
                    SetActivity(BridgeActivity.Idle);
                    SetState(BridgeLinkState.Disconnected);
                }
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
        BridgeConnection conn,
        string envTag,
        ClaimedJob job,
        CancellationToken ct)
    {
        var connectionKey = conn.SupabaseUrl;
        var diag = GetConnDiag(conn);
        var refId = job.Reference ?? job.Id.ToString();
        diag.LastJobRef = refId;
        SetActivity(BridgeActivity.ProcessingJob);
        SetStage(PrintStage.JobStart, $"ref={refId} jobId={job.Id}", envTag);
        diag.LastStage = PrintStage.JobStart;

        // BP-12: never auto-print past TTL
        if (job.ExpiresAt is { } exp && exp < DateTimeOffset.UtcNow)
        {
            SetStage(PrintStage.TtlExpired, $"ref={refId} expiredAt={exp:O}", envTag);
            diag.LastPrintOk = false;
            diag.PrintReason = "TTL expired — job ignored";
            diag.LastStage = PrintStage.TtlExpired;
            try
            {
                await api.ReportAsync(job.Id, false, "TTL_EXPIRED", "Job expired before print", "transport_ack", ct);
                SetStage(PrintStage.ReportFailure, $"TTL reported ref={refId}", envTag);
            }
            catch (Exception ex)
            {
                _offline.EnqueueReport(job.Id, false, "TTL_EXPIRED", ex.Message, "transport_ack", connectionKey);
                SetStage(PrintStage.ReportFailure, $"TTL report queued offline: {ex.Message}", envTag);
            }
            PrintFinished?.Invoke(false, $"{refId} · stopped_at=ttl_expired");
            return;
        }

        byte[] bytes;
        try
        {
            SetActivity(BridgeActivity.Rendering);
            SetStage(PrintStage.RenderStart, $"ref={refId}", envTag);
            bytes = EscPosRenderer.Render(job);
            SetStage(PrintStage.RenderOk, $"ref={refId} bytes={bytes.Length}", envTag);
            diag.LastStage = PrintStage.RenderOk;
        }
        catch (Exception ex)
        {
            SetStage(PrintStage.Failed, $"render failed ref={refId}: {ex.Message}", envTag);
            diag.LastPrintOk = false;
            diag.PrintReason = $"Render failed: {ex.Message}";
            diag.LastStage = PrintStage.Failed;
            await ReportFailAsync(api, connectionKey, job, "RENDER_FAILED", ex.Message, ct, envTag);
            PrintFinished?.Invoke(false, $"{refId} · stopped_at=render · {ex.Message}");
            return;
        }

        string printerName;
        string? wanted;
        try
        {
            wanted = PeekWantedPrinter(job);
            printerName = ResolvePrinterName(job);
            var matchNote = string.IsNullOrWhiteSpace(wanted)
                ? "no wanted name — fallback resolve"
                : string.Equals(wanted, printerName, StringComparison.OrdinalIgnoreCase)
                    ? "exact match"
                    : $"rematched '{wanted}' → '{printerName}'";
            SetStage(
                PrintStage.PrinterResolve,
                $"ref={refId} wanted='{wanted ?? "(null)"}' resolved='{printerName}' ({matchNote}) copies={job.Printer?.DefaultCopies ?? 1}",
                envTag);
            diag.LastStage = PrintStage.PrinterResolve;
            diag.LastStageDetail = matchNote;
        }
        catch (Exception ex)
        {
            SetStage(PrintStage.Failed, $"printer resolve failed ref={refId}: {ex.Message}", envTag);
            diag.LastPrintOk = false;
            diag.PrintReason = $"Printer not matched: {ex.Message}";
            diag.LastStage = PrintStage.Failed;
            await ReportFailAsync(api, connectionKey, job, "PRINTER_RESOLVE_FAILED", ex.Message, ct, envTag);
            PrintFinished?.Invoke(false, $"{refId} · stopped_at=printer_resolve · {ex.Message}");
            return;
        }

        SetActivity(BridgeActivity.Printing);
        SetStage(PrintStage.SpoolerOpen, $"ref={refId} OpenPrinter('{printerName}')", envTag);
        var copies = job.Printer?.DefaultCopies ?? 1;
        var spool = SpoolerTransport.PrintRaw(
            printerName,
            bytes,
            copies,
            docName: $"NIHA {refId}");

        if (!spool.Ok)
        {
            SetStage(PrintStage.Failed, $"ref={refId} stopped_at={spool.Stage} · {spool.Detail}", envTag);
            diag.LastPrintOk = false;
            diag.PrintReason = $"{spool.Stage}: {spool.Detail}";
            diag.LastStage = PrintStage.Failed;
            await ReportFailAsync(
                api,
                connectionKey,
                job,
                "SPOOLER_FAILED",
                $"{spool.Stage}: {spool.Detail}",
                ct,
                envTag);
            PrintFinished?.Invoke(false, $"{refId} · stopped_at={spool.Stage} · {spool.Detail}");
            return;
        }

        SetStage(PrintStage.SpoolerOk, $"ref={refId} {spool.Detail}", envTag);
        diag.LastStage = PrintStage.SpoolerOk;

        // BP-13: only mark success after spooler accepted full byte write — not paper-out proof.
        SetActivity(BridgeActivity.Reporting);
        const string delivery = "transport_ack";
        try
        {
            await api.ReportAsync(job.Id, true, null, null, delivery, ct);
            SetStage(PrintStage.ReportSuccess, $"ref={refId} → {printerName} delivery={delivery}", envTag);
            SetStage(PrintStage.Done, $"ref={refId} pipeline complete", envTag);
            diag.LastPrintOk = true;
            diag.PrintReason = $"OK → {printerName}";
            diag.LastStage = PrintStage.Done;
            PrintFinished?.Invoke(true, $"{refId} → {printerName}");
        }
        catch (Exception ex)
        {
            _offline.EnqueueReport(job.Id, true, null, null, delivery, connectionKey);
            SetStage(
                PrintStage.ReportFailure,
                $"ref={refId} spooler OK but report failed (queued offline): {ex.Message}",
                envTag);
            diag.LastPrintOk = true;
            diag.PrintReason = $"OK → {printerName} (report offline)";
            diag.LastStage = PrintStage.ReportFailure;
            PrintFinished?.Invoke(true, $"{refId} → {printerName} · report_offline");
        }
    }

    private static string SummarizeClaimDiag(string json, string envTag)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var pending = root.TryGetProperty("pending_jobs", out var pj) && pj.ValueKind == JsonValueKind.Array
                ? pj.GetArrayLength()
                : 0;
            if (pending == 0)
            {
                return string.Equals(envTag, "testing", StringComparison.OrdinalIgnoreCase)
                    ? "Session disabled or no pending jobs"
                    : "No pending jobs in DB";
            }

            var reasons = new List<string>();
            foreach (var j in root.GetProperty("pending_jobs").EnumerateArray())
            {
                if (j.TryGetProperty("reject_reason", out var rr))
                {
                    var r = rr.GetString();
                    if (!string.IsNullOrWhiteSpace(r) && r != "CLAIMABLE")
                        reasons.Add(r!);
                }
            }

            if (reasons.Count > 0)
                return $"pending={pending} blocked: {string.Join(", ", reasons.Distinct().Take(3))}";
            return $"pending={pending} (claimable but not returned — check bridge_id binding)";
        }
        catch
        {
            return json.Length > 120 ? json[..120] + "…" : json;
        }
    }

    private async Task ReportFailAsync(
        SupabaseBridgeApi api,
        string connectionKey,
        ClaimedJob job,
        string code,
        string message,
        CancellationToken ct,
        string envTag)
    {
        SetActivity(BridgeActivity.Reporting);
        try
        {
            await api.ReportAsync(job.Id, false, code, message, "transport_ack", ct);
            SetStage(PrintStage.ReportFailure, $"reported {code}: {message}", envTag);
        }
        catch (Exception ex)
        {
            _offline.EnqueueReport(job.Id, false, code, message, "transport_ack", connectionKey);
            SetStage(PrintStage.ReportFailure, $"report queued offline ({code}): {ex.Message}", envTag);
        }
    }

    private static string? PeekWantedPrinter(ClaimedJob job)
    {
        if (job.Printer?.Address is JsonElement el &&
            el.ValueKind == JsonValueKind.Object)
        {
            if (el.TryGetProperty("windows_printer_name", out var wp1))
            {
                var s = wp1.GetString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
            if (el.TryGetProperty("windows_printer", out var wp2))
            {
                var s = wp2.GetString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
        }

        try
        {
            if (job.Payload is JsonElement payload &&
                payload.ValueKind == JsonValueKind.Object &&
                payload.TryGetProperty("windows_printer_name", out var fromPayload))
            {
                var s = fromPayload.GetString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
        }
        catch { /* ignore */ }

        return job.Printer?.Name;
    }

    private static string ResolvePrinterName(ClaimedJob job)
    {
        var wanted = PeekWantedPrinter(job);
        // Never hard-fail on a stale Windows queue name (copy 1 / USB / new PC).
        return WindowsPrinterInventory.ResolveLocalName(wanted);
    }
}
