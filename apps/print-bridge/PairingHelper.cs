using System.Text;
using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Silent parse of pair code, QR payload, or base64url Pairing Token.</summary>
public static class PairingHelper
{
    public sealed record ParsedPair(
        string Code,
        string? Url,
        string? AnonKey,
        string? RestaurantName,
        string? PrintCenterUrl);

    public static bool TryParseInput(string? raw, out ParsedPair parsed)
    {
        parsed = new ParsedPair("", null, null, null, null);
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var text = raw.Trim().Trim('\uFEFF');

        if (text.StartsWith('{'))
            return TryParseJson(text, out parsed);

        // Pairing Token may arrive with newlines/spaces from messaging apps.
        var compact = new string(text.Where(c => !char.IsWhiteSpace(c)).ToArray());
        if (TryDecodeBase64UrlJson(compact, out var json) && TryParseJson(json, out parsed))
            return true;

        // Plain pair code (ignore spaces/dashes)
        var cleaned = new string(text.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        if (cleaned.Length < 6) return false;
        parsed = new ParsedPair(cleaned, null, null, null, null);
        return true;
    }

    private static bool TryParseJson(string text, out ParsedPair parsed)
    {
        parsed = new ParsedPair("", null, null, null, null);
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var code = root.TryGetProperty("code", out var c) ? c.GetString() : null;
            if (string.IsNullOrWhiteSpace(code)) return false;
            parsed = new ParsedPair(
                code.Trim().ToUpperInvariant(),
                root.TryGetProperty("url", out var u) ? u.GetString() : null,
                root.TryGetProperty("anon", out var a) ? a.GetString() : null,
                root.TryGetProperty("restaurantName", out var rn) ? rn.GetString() : null,
                root.TryGetProperty("printCenterUrl", out var pc) ? pc.GetString() : null);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryDecodeBase64UrlJson(string text, out string json)
    {
        json = "";
        if (text.Length < 24) return false;
        if (text.Any(ch => !(char.IsLetterOrDigit(ch) || ch is '-' or '_' or '=')))
            return false;

        try
        {
            var s = text.Replace('-', '+').Replace('_', '/');
            switch (s.Length % 4)
            {
                case 2: s += "=="; break;
                case 3: s += "="; break;
            }
            var bytes = Convert.FromBase64String(s);
            json = Encoding.UTF8.GetString(bytes).Trim().Trim('\uFEFF');
            return json.StartsWith('{');
        }
        catch
        {
            return false;
        }
    }

    public static string EnvLabel(ParsedPair parsed)
    {
        var env = BridgeConnection.DetectEnv(parsed.Url);
        return env switch
        {
            "production" => Ar.EnvProduction,
            "testing" => Ar.EnvTesting,
            _ => string.IsNullOrWhiteSpace(parsed.RestaurantName)
                ? Ar.EnvUnknown
                : parsed.RestaurantName!,
        };
    }

    public static bool HasCloudDefaults(
        BridgeConfig cfg,
        ParsedPair? parsed = null,
        BridgeConnection? forceTarget = null)
    {
        if (parsed is { } p &&
            !string.IsNullOrWhiteSpace(p.Url) &&
            !string.IsNullOrWhiteSpace(p.AnonKey))
            return true;

        if (forceTarget is not null &&
            !string.IsNullOrWhiteSpace(forceTarget.SupabaseUrl) &&
            !string.IsNullOrWhiteSpace(forceTarget.AnonKey))
            return true;

        var target = ResolveTargetConnection(cfg, parsed);
        return !string.IsNullOrWhiteSpace(target.SupabaseUrl) &&
               !string.IsNullOrWhiteSpace(target.AnonKey);
    }

    /// <summary>
    /// Short code alone is not enough when adding a *different* env.
    /// Re-pair of a known target (forceTarget) allows short code.
    /// </summary>
    public static bool RequiresPayloadForSecondEnv(
        BridgeConfig cfg,
        ParsedPair parsed,
        BridgeConnection? forceTarget = null)
    {
        if (forceTarget is not null) return false;
        ConfigStore.Normalize(cfg);
        if (!string.IsNullOrWhiteSpace(parsed.Url)) return false;
        return cfg.PairedConnections().Any();
    }

    /// <summary>
    /// Upsert connection for the pair target URL without removing other envs.
    /// When <paramref name="forceTarget"/> is set (Re-Pair), short codes update that connection only.
    /// </summary>
    public static BridgeConnection UpsertConnection(
        BridgeConfig cfg,
        ParsedPair parsed,
        BridgeConnection? forceTarget = null)
    {
        ConfigStore.Normalize(cfg);

        if (RequiresPayloadForSecondEnv(cfg, parsed, forceTarget))
            throw new InvalidOperationException(Ar.NeedQrForSecondEnv);

        string url;
        if (!string.IsNullOrWhiteSpace(parsed.Url))
            url = parsed.Url!;
        else if (forceTarget is not null && !string.IsNullOrWhiteSpace(forceTarget.SupabaseUrl))
            url = forceTarget.SupabaseUrl;
        else
            url = cfg.PrimaryConnection()?.SupabaseUrl ?? cfg.SupabaseUrl;

        if (string.IsNullOrWhiteSpace(url))
            throw new InvalidOperationException(Ar.MissingCloudConfig);

        // Re-pair: if token URL disagrees with forceTarget, prefer payload URL (correct env).
        BridgeConnection conn;
        if (forceTarget is not null &&
            (string.IsNullOrWhiteSpace(parsed.Url) ||
             BridgeConnection.UrlsMatch(forceTarget.SupabaseUrl, parsed.Url)))
        {
            conn = forceTarget;
        }
        else
        {
            var existing = cfg.FindByUrl(url);
            if (existing is null)
            {
                conn = new BridgeConnection
                {
                    SupabaseUrl = url,
                    AnonKey = parsed.AnonKey ?? cfg.AnonKey ?? "",
                };
                cfg.Connections.Add(conn);
            }
            else
            {
                conn = existing;
            }
        }

        if (!string.IsNullOrWhiteSpace(parsed.Url))
            conn.SupabaseUrl = parsed.Url!;
        if (!string.IsNullOrWhiteSpace(parsed.AnonKey))
            conn.AnonKey = parsed.AnonKey!;
        if (!string.IsNullOrWhiteSpace(parsed.RestaurantName))
            conn.RestaurantName = parsed.RestaurantName;
        if (!string.IsNullOrWhiteSpace(parsed.PrintCenterUrl))
            conn.PrintCenterUrl = parsed.PrintCenterUrl;

        conn.Env = BridgeConnection.DetectEnv(conn.SupabaseUrl);
        ConfigStore.SyncLegacyFields(cfg);
        return conn;
    }

    public static BridgeConnection ResolveTargetConnection(BridgeConfig cfg, ParsedPair? parsed)
    {
        if (parsed is { } p && !string.IsNullOrWhiteSpace(p.Url))
        {
            var existing = cfg.FindByUrl(p.Url);
            if (existing is not null) return existing;
            return new BridgeConnection
            {
                SupabaseUrl = p.Url!,
                AnonKey = p.AnonKey ?? "",
                Env = BridgeConnection.DetectEnv(p.Url),
            };
        }

        return cfg.PrimaryConnection() ?? new BridgeConnection
        {
            SupabaseUrl = cfg.SupabaseUrl,
            AnonKey = cfg.AnonKey,
            BridgeToken = cfg.BridgeToken,
            BridgeId = cfg.BridgeId,
            RestaurantName = cfg.RestaurantName,
            RestaurantId = cfg.RestaurantId,
            PrintCenterUrl = cfg.PrintCenterUrl,
            Env = BridgeConnection.DetectEnv(cfg.SupabaseUrl),
        };
    }

    /// <summary>Strip pairing credentials for one connection — keep URL/anon for Re-Pair with short code.</summary>
    public static void ClearPairingCredentials(BridgeConnection conn)
    {
        conn.BridgeToken = null;
        conn.BridgeId = null;
        conn.LastHeartbeatAt = null;
        conn.LastError = null;
    }
}
