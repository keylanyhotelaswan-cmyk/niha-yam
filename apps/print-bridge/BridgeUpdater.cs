using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>
/// Checks Print Center published manifest and applies self-update for cashiers
/// (no admin Print Center visit required).
/// </summary>
public static class BridgeUpdater
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public sealed class Manifest
    {
        public string? Name { get; set; }
        public string? Version { get; set; }
        public string? File { get; set; }
        public string? Url { get; set; }
        public string? SetupUrl { get; set; }
        public string? SetupFile { get; set; }
        public long? SizeBytes { get; set; }
        public string? Notes { get; set; }
    }

    public sealed class CheckResult
    {
        public bool Ok { get; init; }
        public string Message { get; init; } = "";
        public Manifest? Manifest { get; init; }
        public bool UpdateAvailable { get; init; }
        public string? CurrentVersion { get; init; }
        public string? LatestVersion { get; init; }
    }

    public static string CurrentVersion =>
        typeof(BridgeUpdater).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    public static string? ResolveOrigin(BridgeConfig cfg)
    {
        var pc = cfg.PrintCenterUrl?.Trim();
        if (!string.IsNullOrWhiteSpace(pc))
        {
            pc = pc.TrimEnd('/');
            const string suffix = "/admin/print";
            if (pc.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                pc = pc[..^suffix.Length];
            if (!string.IsNullOrWhiteSpace(pc))
                return pc.TrimEnd('/');
        }

        // Official production app (cashiers never open Print Center)
        return "https://niha-yam.vercel.app";
    }

    public static async Task<CheckResult> CheckAsync(BridgeConfig cfg, CancellationToken ct = default)
    {
        var origin = ResolveOrigin(cfg);
        if (string.IsNullOrWhiteSpace(origin))
            return new CheckResult { Ok = false, Message = Ar.UpdateNoUrl, CurrentVersion = CurrentVersion };

        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var manifestUrl = $"{origin}/downloads/bridge-manifest.json";
            using var res = await http.GetAsync(manifestUrl, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                return new CheckResult
                {
                    Ok = false,
                    Message = $"{Ar.UpdateCheckFail} ({(int)res.StatusCode})",
                    CurrentVersion = CurrentVersion,
                };

            var man = JsonSerializer.Deserialize<Manifest>(text, JsonOpts);
            var latest = man?.Version?.Trim();
            if (string.IsNullOrWhiteSpace(latest))
                return new CheckResult { Ok = false, Message = Ar.UpdateCheckFail, CurrentVersion = CurrentVersion };

            var available = CompareVersions(CurrentVersion, latest) < 0;
            return new CheckResult
            {
                Ok = true,
                Message = available
                    ? string.Format(Ar.UpdateAvailableFmt, CurrentVersion, latest)
                    : string.Format(Ar.UpdateUpToDateFmt, CurrentVersion),
                Manifest = man,
                UpdateAvailable = available,
                CurrentVersion = CurrentVersion,
                LatestVersion = latest,
            };
        }
        catch (Exception ex)
        {
            return new CheckResult
            {
                Ok = false,
                Message = $"{Ar.UpdateCheckFail}: {ex.Message}",
                CurrentVersion = CurrentVersion,
            };
        }
    }

    public static async Task<(bool ok, string message)> DownloadAndApplyAsync(
        BridgeConfig cfg,
        Manifest manifest,
        IProgress<(string status, int percent)>? progress = null,
        CancellationToken ct = default)
    {
        var origin = ResolveOrigin(cfg);
        if (string.IsNullOrWhiteSpace(origin) || string.IsNullOrWhiteSpace(manifest.Url))
            return (false, Ar.UpdateNoUrl);

        var updatesDir = Path.Combine(ConfigStore.Dir, "updates");
        Directory.CreateDirectory(updatesDir);
        var zipPath = Path.Combine(updatesDir, "package.zip");
        var extractDir = Path.Combine(updatesDir, "extract");
        if (Directory.Exists(extractDir))
            Directory.Delete(extractDir, true);
        Directory.CreateDirectory(extractDir);

        try
        {
            var zipUrl = manifest.Url!.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? manifest.Url
                : $"{origin}{manifest.Url}";

            progress?.Report((string.Format(Ar.UpdateDownloading, 0), 0));

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            using var res = await http.GetAsync(zipUrl, HttpCompletionOption.ResponseHeadersRead, ct);
            res.EnsureSuccessStatusCode();
            var total = res.Content.Headers.ContentLength ?? manifest.SizeBytes ?? -1L;
            await using (var fs = File.Create(zipPath))
            await using (var stream = await res.Content.ReadAsStreamAsync(ct))
            {
                var buffer = new byte[81920];
                long readTotal = 0;
                int read;
                while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct)) > 0)
                {
                    await fs.WriteAsync(buffer.AsMemory(0, read), ct);
                    readTotal += read;
                    if (total > 0)
                    {
                        var pct = (int)Math.Min(90, readTotal * 90 / total);
                        progress?.Report((string.Format(Ar.UpdateDownloading, pct), pct));
                    }
                }
            }

            progress?.Report((Ar.UpdateVerifying, 92));
            ZipFile.ExtractToDirectory(zipPath, extractDir);

            var srcDir = FindPublishedFolder(extractDir);
            if (srcDir is null)
                return (false, Ar.UpdateBadPackage);

            progress?.Report((Ar.UpdateInstalling, 96));

            // Install dir only — never touch %LocalAppData%\NihaPrintBridge data.
            var destDir = Path.GetDirectoryName(Application.ExecutablePath)
                ?? AppContext.BaseDirectory;
            var script = Path.Combine(updatesDir, "apply-update.cmd");
            var srcEsc = srcDir.Replace("\"", "");
            var destEsc = destDir.Replace("\"", "");
            var exeName = Path.GetFileName(Application.ExecutablePath);
            var pid = Environment.ProcessId;
            // Wait for this PID to exit (file unlock), then retry xcopy — avoids silent
            // failed updates when the self-contained EXE is still locked.
            File.WriteAllText(script, $"""
@echo off
chcp 65001 >nul
set "SRC={srcEsc}"
set "DEST={destEsc}"
set "EXE={exeName}"
set "PID={pid}"
set /a ATTEMPTS=0

:waitpid
set /a ATTEMPTS+=1
tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul
if errorlevel 1 goto copyfiles
if %ATTEMPTS% GEQ 60 goto copyfiles
timeout /t 1 /nobreak >nul
goto waitpid

:copyfiles
set /a COPYTRY=0
:copyretry
set /a COPYTRY+=1
xcopy /y /e /i /q "%SRC%\*" "%DEST%\"
if errorlevel 1 (
  if %COPYTRY% GEQ 10 exit /b 1
  timeout /t 1 /nobreak >nul
  goto copyretry
)
start "" "%DEST%\%EXE%"
""", System.Text.Encoding.Default);

            progress?.Report((Ar.UpdateRestarting, 100));

            var psi = new ProcessStartInfo
            {
                FileName = script,
                UseShellExecute = true,
                WorkingDirectory = updatesDir,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            Process.Start(psi);

            // Refresh autostart to the same install path after restart.
            try { Autostart.ApplyFromConfig(cfg); } catch { /* ignore */ }

            return (true, Ar.UpdateApplying);
        }
        catch (Exception ex)
        {
            return (false, $"{Ar.UpdateFail}: {ex.Message}");
        }
    }

    private static string? FindPublishedFolder(string extractRoot)
    {
        var direct = Path.Combine(extractRoot, "NihaPrintBridge");
        if (File.Exists(Path.Combine(direct, "Niha.PrintBridge.exe")))
            return direct;

        var exe = Directory.EnumerateFiles(extractRoot, "Niha.PrintBridge.exe", SearchOption.AllDirectories)
            .FirstOrDefault();
        return exe is null ? null : Path.GetDirectoryName(exe);
    }

    /// <summary>Negative = a &lt; b.</summary>
    public static int CompareVersions(string a, string b)
    {
        static int[] Parse(string v) =>
            v.Replace("v", "", StringComparison.OrdinalIgnoreCase)
                .Split(['.', '+', '-'], StringSplitOptions.RemoveEmptyEntries)
                .Select(p => int.TryParse(p, out var n) ? n : 0)
                .ToArray();

        var pa = Parse(a);
        var pb = Parse(b);
        var len = Math.Max(pa.Length, pb.Length);
        for (var i = 0; i < len; i++)
        {
            var d = (i < pa.Length ? pa[i] : 0) - (i < pb.Length ? pb[i] : 0);
            if (d != 0) return d < 0 ? -1 : 1;
        }
        return 0;
    }
}
