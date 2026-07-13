using System.Text.Json;

namespace Niha.PrintBridge;

/// <summary>Silent parse of pair code or QR payload — never shown to the user as JSON.</summary>
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
        {
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

        // Plain pair code
        var cleaned = new string(text.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        if (cleaned.Length < 6) return false;
        parsed = new ParsedPair(cleaned, null, null, null, null);
        return true;
    }

    public static bool HasCloudDefaults(BridgeConfig cfg) =>
        !string.IsNullOrWhiteSpace(cfg.SupabaseUrl) &&
        !string.IsNullOrWhiteSpace(cfg.AnonKey);

    public static void ApplyParsed(BridgeConfig cfg, ParsedPair parsed)
    {
        if (!string.IsNullOrWhiteSpace(parsed.Url))
            cfg.SupabaseUrl = parsed.Url!;
        if (!string.IsNullOrWhiteSpace(parsed.AnonKey))
            cfg.AnonKey = parsed.AnonKey!;
        if (!string.IsNullOrWhiteSpace(parsed.RestaurantName))
            cfg.RestaurantName = parsed.RestaurantName;
        if (!string.IsNullOrWhiteSpace(parsed.PrintCenterUrl))
            cfg.PrintCenterUrl = parsed.PrintCenterUrl;
    }
}
