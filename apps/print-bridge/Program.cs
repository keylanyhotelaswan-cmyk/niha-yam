namespace Niha.PrintBridge;

static class Program
{
    private const string SingleInstanceMutexName = "Local\\NIHA.PrintBridge.SingleInstance";

    [STAThread]
    static void Main()
    {
        // Required for Encoding.GetEncoding(1256) on .NET 8 (Arabic ESC/POS)
        ArabicEncoding.EnsureRegistered();

        using var mutex = new Mutex(initiallyOwned: true, SingleInstanceMutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show(
                Ar.AlreadyRunning,
                Ar.AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayApplicationContext());

        GC.KeepAlive(mutex);
    }
}
