namespace Niha.PrintBridge;

static class Program
{
    [STAThread]
    static void Main()
    {
        // Required for Encoding.GetEncoding(1256) on .NET 8 (Arabic ESC/POS)
        ArabicEncoding.EnsureRegistered();

        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayApplicationContext());
    }
}
