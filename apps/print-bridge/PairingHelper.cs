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
        var text = raw.Trim();

        if (text.StartsWith('{'))
            return TryParseJson(text, out parsed);

        // Pairing Token: single-line base64url of the same JSON as QR.
        if (TryDecodeBase64UrlJson(text, out var json) && TryParseJson(json, out parsed))
            return true;

        // Plain pair code
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
        // Short codes are short alnum; tokens are long base64url.
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
            json = Encoding.UTF8.GetString(bytes).Trim();
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

    public static bool HasCloudDefaults(BridgeConfig cfg, ParsedPair? parsed = null)
    {
        if (parsed is { } p &&
            !string.IsNullOrWhiteSpace(p.Url) &&
            !string.IsNullOrWhiteSpace(p.AnonKey))
            return true;

        var target = ResolveTargetConnection(cfg, parsed);
        return !string.IsNullOrWhiteSpace(target.SupabaseUrl) &&
               !string.IsNullOrWhiteSpace(target.AnonKey);
    }

    /// <summary>
    /// True when the operator already has at least one paired env and the input
    /// is only a short code (no URL). Dual-env requires QR/payload so we know
    /// which Supabase project to add — otherwise we would overwrite Production.
    /// </summary>
    public static bool RequiresPayloadForSecondEnv(BridgeConfig cfg, ParsedPair parsed)
    {
        ConfigStore.Normalize(cfg);
        if (!string.IsNullOrWhiteSpace(parsed.Url)) return false;
        return cfg.PairedConnections().Any();
    }

    /// <summary>
    /// Upsert connection for the pair target URL without removing other envs.
    /// Re-pairing Testing adds/updates Testing; Production stays intact.
    /// Plain pair codes (no URL) only allowed for the first connection.
    /// </summary>
    public static BridgeConnection UpsertConnection(BridgeConfig cfg, ParsedPair parsed)
    {
        ConfigStore.Normalize(cfg);

        if (RequiresPayloadForSecondEnv(cfg, parsed))
            throw new InvalidOperationException(Ar.NeedQrForSecondEnv);

        var url = !string.IsNullOrWhiteSpace(parsed.Url)
            ? parsed.Url!
            : cfg.PrimaryConnection()?.SupabaseUrl ?? cfg.SupabaseUrl;

        if (string.IsNullOrWhiteSpace(url))
            throw new InvalidOperationException(Ar.MissingCloudConfig);

        var conn = cfg.FindByUrl(url);
        if (conn is null)
        {
            conn = new BridgeConnection
            {
                SupabaseUrl = url,
                AnonKey = parsed.AnonKey ?? cfg.AnonKey ?? "",
            };
            cfg.Connections.Add(conn);
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

    [Obsolete("Use UpsertConnection")]
    public static void ApplyParsed(BridgeConfig cfg, ParsedPair parsed) =>
        UpsertConnection(cfg, parsed);
}
