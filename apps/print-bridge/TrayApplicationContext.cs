namespace Niha.PrintBridge;

public sealed class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly BridgeConfig _cfg;
    private readonly BridgeLogger _log;
    private readonly OfflineStore _offline;
    private readonly PrintWorker _worker;
    private readonly ToolStripMenuItem _autostartItem;
    private readonly ToolStripMenuItem _autoUpdateItem;
    private MainForm? _main;
    private System.Windows.Forms.Timer? _updateTimer;

    public TrayApplicationContext()
    {
        _cfg = ConfigStore.Load();
        _log = new BridgeLogger(ConfigStore.LogPath);
        _offline = new OfflineStore(ConfigStore.DbPath);
        _worker = new PrintWorker(_cfg, _log, _offline);

        Autostart.ApplyFromConfig(_cfg);

        _autostartItem = new ToolStripMenuItem(Ar.StartWithWindows)
        {
            Checked = _cfg.StartWithWindows,
            CheckOnClick = true,
        };
        _autostartItem.CheckedChanged += (_, _) =>
        {
            _cfg.StartWithWindows = _autostartItem.Checked;
            _cfg.StartWithWindowsInitialized = true;
            Autostart.SetEnabled(_cfg.StartWithWindows);
            ConfigStore.Save(_cfg);
            _main?.SyncSettingsUi();
        };

        _autoUpdateItem = new ToolStripMenuItem(Ar.AutoUpdate)
        {
            Checked = _cfg.AutoUpdate,
            CheckOnClick = true,
        };
        _autoUpdateItem.CheckedChanged += (_, _) =>
        {
            _cfg.AutoUpdate = _autoUpdateItem.Checked;
            ConfigStore.Save(_cfg);
            _main?.SyncSettingsUi();
        };

        var menu = new ContextMenuStrip();
        menu.RightToLeft = RightToLeft.Yes;
        menu.Items.Add(Ar.ShowWindow, null, (_, _) => ShowMain());
        menu.Items.Add(Ar.RePair, null, (_, _) => DoPair(force: true));
        menu.Items.Add(_autostartItem);
        menu.Items.Add(_autoUpdateItem);
        menu.Items.Add(Ar.CheckUpdate, null, async (_, _) =>
        {
            await RunUpdateCheckAsync(interactive: true);
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(Ar.Exit, null, async (_, _) =>
        {
            _updateTimer?.Stop();
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

        BeginInvokeShow();
        StartUpdateLoop();
    }

    private void StartUpdateLoop()
    {
        // First check shortly after start; then every 6 hours.
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(8000);
                await RunUpdateCheckAsync(interactive: false);
            }
            catch { /* ignore */ }
        });

        _updateTimer = new System.Windows.Forms.Timer { Interval = 6 * 60 * 60 * 1000 };
        _updateTimer.Tick += async (_, _) =>
        {
            try { await RunUpdateCheckAsync(interactive: false); }
            catch { /* ignore */ }
        };
        _updateTimer.Start();
    }

    public async Task RunUpdateCheckAsync(bool interactive)
    {
        if (!_cfg.AutoUpdate && !interactive)
            return;

        var check = await BridgeUpdater.CheckAsync(_cfg);
        _log.Info($"update check: {check.Message}");

        if (!check.Ok)
        {
            if (interactive)
                MessageBox.Show(check.Message, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (!check.UpdateAvailable)
        {
            if (interactive)
                MessageBox.Show(check.Message, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        if (!interactive && !_cfg.AutoUpdate)
            return;

        var go = interactive
            ? MessageBox.Show(
                $"{check.Message}\n\n{Ar.UpdateConfirm}",
                Ar.AppTitle,
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question) == DialogResult.Yes
            : true;

        if (!go || check.Manifest is null)
            return;

        var (ok, msg) = await BridgeUpdater.DownloadAndApplyAsync(_cfg, check.Manifest);
        _log.Info($"update apply: {msg}");
        if (!ok)
        {
            MessageBox.Show(msg, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (interactive)
            MessageBox.Show(msg, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);

        await _worker.StopAsync();
        _offline.Dispose();
        _tray.Visible = false;
        Application.Exit();
    }

    private void BeginInvokeShow()
    {
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
            _main = new MainForm(_cfg, _log, _worker, _tray, this);
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
            // New PC: ensure it always comes back after reboot
            _cfg.StartWithWindows = true;
            _cfg.StartWithWindowsInitialized = true;
            Autostart.SetEnabled(true);
            ConfigStore.Save(_cfg);
            _autostartItem.Checked = true;

            _tray.Text = Ar.TrayPaired;
            _main?.RefreshStatus(BridgeLinkState.Connecting);
            _main?.SyncSettingsUi();
            MessageBox.Show(Ar.PairSuccess, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            ShowMain();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _updateTimer?.Dispose();
            _tray.Dispose();
            _main?.Dispose();
        }
        base.Dispose(disposing);
    }
}
