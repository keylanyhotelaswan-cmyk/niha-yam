using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>
/// Thin Supabase RPC client for Bridge only (BP-10: no business logic).
/// Auth: anon key + bridge token — never service_role.
/// </summary>
public sealed class SupabaseBridgeApi
{
    private readonly HttpClient _http;
    private readonly BridgeConfig _cfg;
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public SupabaseBridgeApi(BridgeConfig cfg)
    {
        _cfg = cfg;
        _http = new HttpClient { BaseAddress = new Uri(cfg.SupabaseUrl.TrimEnd('/') + "/") };
        _http.DefaultRequestHeaders.Add("apikey", cfg.AnonKey);
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", cfg.AnonKey);
    }

    public async Task<JsonElement> PairAsync(
        string code,
        string displayName,
        string deviceName,
        string windowsUser,
        string version,
        CancellationToken ct)
    {
        var body = new
        {
            p_code = code.Trim().ToUpperInvariant(),
            p_display_name = displayName,
            p_device_name = deviceName,
            p_windows_username = windowsUser,
            p_version = version,
        };
        using var res = await _http.PostAsJsonAsync("rest/v1/rpc/pair_print_bridge", body, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"pair_print_bridge failed: {text}");
        return JsonSerializer.Deserialize<JsonElement>(text, JsonOpts);
    }

    public async Task HeartbeatAsync(bool restarted, CancellationToken ct)
    {
        EnsureToken();
        var body = new
        {
            p_token = _cfg.BridgeToken,
            p_device_name = Environment.MachineName,
            p_windows_username = Environment.UserName,
            p_version = typeof(SupabaseBridgeApi).Assembly.GetName().Version?.ToString() ?? "0.2.1",
            p_restarted = restarted,
        };
        using var res = await _http.PostAsJsonAsync("rest/v1/rpc/bridge_heartbeat", body, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"bridge_heartbeat failed: {text}");

        // Prefer restaurant name from server (works for already-paired bridges)
        try
        {
            if (!string.IsNullOrWhiteSpace(text) && text != "null" && text.TrimStart().StartsWith('{'))
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("restaurant_name", out var rn))
                {
                    var name = rn.GetString();
                    if (!string.IsNullOrWhiteSpace(name) &&
                        !string.Equals(_cfg.RestaurantName, name, StringComparison.Ordinal))
                    {
                        _cfg.RestaurantName = name;
                        if (doc.RootElement.TryGetProperty("restaurant_id", out var rid))
                            _cfg.RestaurantId = rid.GetString();
                        ConfigStore.Save(_cfg);
                    }
                }
            }
        }
        catch
        {
            // Heartbeat success matters more than name parse
        }
    }

    public async Task<List<ClaimedJob>> ClaimAsync(int limit, CancellationToken ct)
    {
        EnsureToken();
        var body = new
        {
            p_bridge_id = (Guid?)null,
            p_limit = limit,
            p_token = _cfg.BridgeToken,
        };
        using var res = await _http.PostAsJsonAsync("rest/v1/rpc/claim_print_jobs", body, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"claim_print_jobs failed: {text}");
        if (string.IsNullOrWhiteSpace(text) || text == "null")
            return [];
        return JsonSerializer.Deserialize<List<ClaimedJob>>(text, JsonOpts) ?? [];
    }

    public async Task ReportAsync(
        Guid jobId,
        bool success,
        string? errorCode,
        string? errorMessage,
        string delivery,
        CancellationToken ct)
    {
        EnsureToken();
        var body = new Dictionary<string, object?>
        {
            ["p_job_id"] = jobId,
            ["p_success"] = success,
            ["p_error_code"] = errorCode,
            ["p_error_message"] = errorMessage,
            ["p_bridge_id"] = null,
            ["p_token"] = _cfg.BridgeToken,
            ["p_delivery"] = delivery,
        };
        using var content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var res = await _http.PostAsync("rest/v1/rpc/report_print_attempt", content, ct);
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync(ct);
            // Duplicate ACK / already completed — treat as ok for idempotency
            if (text.Contains("INVALID_STATE", StringComparison.OrdinalIgnoreCase) && success)
                return;
            throw new InvalidOperationException($"report_print_attempt failed: {text}");
        }
    }

    public async Task ReportPrintersAsync(
        IEnumerable<(string Name, bool IsVirtual)> printers,
        CancellationToken ct)
    {
        EnsureToken();
        var list = printers
            .Select(p => new { name = p.Name, is_virtual = p.IsVirtual })
            .ToArray();
        var body = new { p_token = _cfg.BridgeToken, p_printers = list };
        using var res = await _http.PostAsJsonAsync("rest/v1/rpc/report_bridge_printers", body, ct);
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"report_bridge_printers failed: {text}");
        }
    }

    private void EnsureToken()
    {
        if (string.IsNullOrWhiteSpace(_cfg.BridgeToken))
            throw new InvalidOperationException("Bridge not paired.");
    }
}
