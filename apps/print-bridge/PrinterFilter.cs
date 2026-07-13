namespace Niha.PrintBridge;

/// <summary>Hide common virtual / document printers so operators pick a real device.</summary>
public static class PrinterFilter
{
    private static readonly string[] VirtualNeedles =
    [
        "pdf",
        "xps",
        "onenote",
        "fax",
        "microsoft print to",
        "send to onenote",
        "document writer",
        "adobe pdf",
        "foxit",
        "cutepdf",
        "bullzip",
        "do pdf",
        "nova pdf",
        "print to file",
    ];

    public static bool IsVirtual(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName)) return true;
        var n = printerName.ToLowerInvariant();
        return VirtualNeedles.Any(v => n.Contains(v, StringComparison.Ordinal));
    }

    public static IEnumerable<string> Filter(
        IEnumerable<string> installed,
        bool showVirtual)
    {
        foreach (var name in installed)
        {
            if (showVirtual || !IsVirtual(name))
                yield return name;
        }
    }
}
