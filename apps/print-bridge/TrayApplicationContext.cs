using Microsoft.Win32;

namespace Niha.PrintBridge;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly BridgeConfig _cfg;
    private readonly BridgeLogger _log;
    private readonly OfflineStore _offline;
    private readonly PrintWorker _worker;
    private readonly ToolStripMenuItem _autostartItem;
    private MainForm? _main;

    public TrayApplicationContext()
    {
        _cfg = ConfigStore.Load();
        _log = new BridgeLogger(ConfigStore.LogPath);
        _offline = new OfflineStore(ConfigStore.DbPath);
        _worker = new PrintWorker(_cfg, _log, _offline);

        _autostartItem = new ToolStripMenuItem(Ar.StartWithWindows)
        {
            Checked = IsAutostartEnabled(),
            CheckOnClick = true,
        };
        _autostartItem.CheckedChanged += (_, _) => SetAutostart(_autostartItem.Checked);

        var menu = new ContextMenuStrip();
        menu.RightToLeft = RightToLeft.Yes;
        menu.Items.Add(Ar.ShowWindow, null, (_, _) => ShowMain());
        menu.Items.Add(Ar.RePair, null, (_, _) => DoPair(force: true));
        menu.Items.Add(_autostartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(Ar.Exit, null, async (_, _) =>
        {
            await _worker.StopAsync();
            _offline.Dispose();
            _main?.Dispose();
            if (_tray is not null) _tray.Visible = false;
            ExitThread();
        });

        Icon? icon = null;
        try { icon = NihaTheme.CreateAppIcon(); } catch { /* fallback */ }

        _tray = new NotifyIcon
        {
            Icon = icon ?? SystemIcons.Application,
            Visible = true,
            Text = string.IsNullOrWhiteSpace(_cfg.BridgeToken)
                ? Ar.TrayNotPaired
                : Ar.TrayPaired,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => ShowMain();

        _log.Info("Bridge started");
        _worker.Start();

        // First run: pair if needed, then show main window
        BeginInvokeShow();
    }

    private void BeginInvokeShow()
    {
        // ApplicationContext has no BeginInvoke — use sync timer
        var t = new System.Windows.Forms.Timer { Interval = 200 };
        t.Tick += (_, _) =>
        {
            t.Stop();
            t.Dispose();
            if (string.IsNullOrWhiteSpace(_cfg.BridgeToken))
                DoPair(force: false);
            ShowMain();
        };
        t.Start();
    }

    private void ShowMain()
    {
        if (_main is null || _main.IsDisposed)
        {
            _main = new MainForm(_cfg, _log, _worker, _tray);
            _main.RePairRequested += () => DoPair(force: true);
        }

        _main.Show();
        _main.WindowState = FormWindowState.Normal;
        _main.BringToFront();
        _main.Activate();
        _main.RefreshStatus(
            string.IsNullOrWhiteSpace(_cfg.BridgeToken)
                ? BridgeLinkState.NotPaired
                : BridgeLinkState.Connecting);
    }

    private void DoPair(bool force)
    {
        if (!force && !string.IsNullOrWhiteSpace(_cfg.BridgeToken))
            return;

        if (force)
        {
            _cfg.BridgeToken = null;
            _cfg.BridgeId = null;
            ConfigStore.Save(_cfg);
            _tray.Text = Ar.TrayNotPaired;
        }

        using var form = new PairForm(_cfg);
        if (form.ShowDialog() == DialogResult.OK && form.PairedOk)
        {
            _tray.Text = Ar.TrayPaired;
            _main?.RefreshStatus(BridgeLinkState.Connecting);
            MessageBox.Show(Ar.PairSuccess, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            ShowMain();
        }
    }

    private static bool IsAutostartEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", false);
        return key?.GetValue("NihaPrintBridge") is not null;
    }

    private static void SetAutostart(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key is null) return;
        if (enabled)
            key.SetValue("NihaPrintBridge", Application.ExecutablePath);
        else
            key.DeleteValue("NihaPrintBridge", false);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Dispose();
            _main?.Dispose();
        }
        base.Dispose(disposing);
    }
}
