using System.Text;

namespace Niha.PrintBridge;

/// <summary>Windows-1256 for Arabic ESC/POS — requires CodePagesEncodingProvider.</summary>
public static class ArabicEncoding
{
    private static readonly Encoding Cp1256;

    static ArabicEncoding()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Cp1256 = Encoding.GetEncoding(1256);
    }

    public static void EnsureRegistered()
    {
        // Touch static ctor
        _ = Cp1256;
    }

    public static byte[] GetBytes(string text) => Cp1256.GetBytes(text);

    public static Encoding Instance => Cp1256;
}
