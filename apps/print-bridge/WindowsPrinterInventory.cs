using System.Management;

namespace Niha.PrintBridge;

/// <summary>One Windows spooler queue with identity hints beyond the display name.</summary>
public sealed record WindowsPrinterInfo(
    string Name,
    bool IsVirtual,
    bool IsDefault,
    string? DriverName,
    string? PortName,
    string? DeviceId);

/// <summary>
/// Discovers local printers with driver/port/default via WMI (Win32_Printer),
/// falling back to InstalledPrinters names only if WMI is unavailable.
/// </summary>
public static class WindowsPrinterInventory
{
    public static IReadOnlyList<WindowsPrinterInfo> Discover()
    {
        try
        {
            var fromWmi = DiscoverViaWmi();
            if (fromWmi.Count > 0) return fromWmi;
        }
        catch
        {
            /* fall through */
        }

        return DiscoverNamesOnly();
    }

    private static List<WindowsPrinterInfo> DiscoverViaWmi()
    {
        var list = new List<WindowsPrinterInfo>();
        using var searcher = new ManagementObjectSearcher(
            "SELECT Name, DriverName, PortName, Default, DeviceID FROM Win32_Printer");
        foreach (ManagementObject mo in searcher.Get())
        {
            using (mo)
            {
                var name = (mo["Name"] as string)?.Trim();
                if (string.IsNullOrWhiteSpace(name)) continue;
                var driver = (mo["DriverName"] as string)?.Trim();
                var port = (mo["PortName"] as string)?.Trim();
                var deviceId = (mo["DeviceID"] as string)?.Trim();
                var isDefault = mo["Default"] is true;
                list.Add(new WindowsPrinterInfo(
                    name,
                    PrinterFilter.IsVirtual(name) || LooksVirtualDriver(driver),
                    isDefault,
                    string.IsNullOrWhiteSpace(driver) ? null : driver,
                    string.IsNullOrWhiteSpace(port) ? null : port,
                    string.IsNullOrWhiteSpace(deviceId) ? null : deviceId));
            }
        }
        return list;
    }

    private static List<WindowsPrinterInfo> DiscoverNamesOnly()
    {
        var list = new List<WindowsPrinterInfo>();
        string? defaultName = null;
        try
        {
            var settings = new System.Drawing.Printing.PrinterSettings();
            if (settings.IsValid) defaultName = settings.PrinterName;
        }
        catch { /* ignore */ }

        foreach (string name in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
        {
            list.Add(new WindowsPrinterInfo(
                name,
                PrinterFilter.IsVirtual(name),
                string.Equals(name, defaultName, StringComparison.OrdinalIgnoreCase),
                null,
                null,
                null));
        }
        return list;
    }

    private static bool LooksVirtualDriver(string? driver)
    {
        if (string.IsNullOrWhiteSpace(driver)) return false;
        var d = driver.ToLowerInvariant();
        return d.Contains("pdf", StringComparison.Ordinal)
            || d.Contains("xps", StringComparison.Ordinal)
            || d.Contains("onenote", StringComparison.Ordinal)
            || d.Contains("document writer", StringComparison.Ordinal);
    }

    /// <summary>
    /// Local resolve when the bound Windows name is missing after an OS reinstall/rename.
    /// Prefer exact → normalized/base → sole thermal → default → first physical.
    /// </summary>
    public static string ResolveLocalName(string? wanted)
    {
        var all = Discover();
        var physical = all.Where(p => !p.IsVirtual).ToList();
        if (physical.Count == 0)
            return wanted ?? "Microsoft Print to PDF";

        if (!string.IsNullOrWhiteSpace(wanted))
        {
            var exact = physical.FirstOrDefault(p =>
                string.Equals(p.Name, wanted, StringComparison.OrdinalIgnoreCase));
            if (exact is not null) return exact.Name;

            var wantNorm = Normalize(wanted);
            var wantBase = BaseModel(wantNorm);
            var byNorm = physical.FirstOrDefault(p => Normalize(p.Name) == wantNorm);
            if (byNorm is not null) return byNorm.Name;
            var byBase = physical.Where(p => BaseModel(Normalize(p.Name)) == wantBase).ToList();
            if (byBase.Count == 1) return byBase[0].Name;
        }

        var thermals = physical.Where(LooksThermal).ToList();
        if (thermals.Count == 1) return thermals[0].Name;

        var def = physical.FirstOrDefault(p => p.IsDefault);
        if (def is not null) return def.Name;

        return PreferXp(physical)?.Name ?? physical[0].Name;
    }

    public static bool LooksThermal(WindowsPrinterInfo p)
    {
        var blob = $"{p.Name} {p.DriverName} {p.PortName}".ToLowerInvariant();
        return blob.Contains("xp-", StringComparison.Ordinal)
            || blob.Contains("thermal", StringComparison.Ordinal)
            || blob.Contains("pos", StringComparison.Ordinal)
            || blob.Contains("receipt", StringComparison.Ordinal)
            || blob.Contains("escpos", StringComparison.Ordinal)
            || blob.Contains("epson tm", StringComparison.Ordinal)
            || (p.PortName is not null
                && p.PortName.StartsWith("USB", StringComparison.OrdinalIgnoreCase)
                && !PrinterFilter.IsVirtual(p.Name));
    }

    private static WindowsPrinterInfo? PreferXp(IEnumerable<WindowsPrinterInfo> list) =>
        list.FirstOrDefault(p => p.Name.StartsWith("XP-", StringComparison.OrdinalIgnoreCase))
        ?? list.FirstOrDefault(p =>
            (p.Name + p.DriverName).Contains("thermal", StringComparison.OrdinalIgnoreCase));

    internal static string Normalize(string name)
    {
        var n = name.Trim().ToLowerInvariant();
        n = System.Text.RegularExpressions.Regex.Replace(n, @"\s*\(copy\s*\d+\)\s*", " ",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        n = System.Text.RegularExpressions.Regex.Replace(n, @"\s+usb\s*$", "",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        n = System.Text.RegularExpressions.Regex.Replace(n, @"\s+", " ").Trim();
        return n;
    }

    internal static string BaseModel(string normalized) =>
        System.Text.RegularExpressions.Regex.Replace(normalized, @"([0-9])[a-z]$", "$1");
}
