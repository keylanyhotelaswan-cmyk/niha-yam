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
        menu.Items.Add(Ar.ManageConnections, null, (_, _) =>
        {
            ShowMain();
            _main?.ShowConnections();
        });
        menu.Items.Add(_autostartItem);
        menu.Items.Add(_autoUpdateItem);
        menu.Items.Add(Ar.CheckUpdate, null, async (_, _) =>
        {
            await RunUpdateCheckAsync(interactive: true);
        });
        menu.Items.Add(Ar.About, null, (_, _) =>
        {
            ShowMain();
            _main?.ShowAbout();
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
            Text = !_cfg.PairedConnections().Any()
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
        // Always show UpdateForm on the UI thread.
        if (_main is { IsHandleCreated: true, IsDisposed: false } && _main.InvokeRequired)
        {
            var tcs = new TaskCompletionSource();
            _main.BeginInvoke(new Action(async () =>
            {
                try
                {
                    await RunUpdateCheckCoreAsync(interactive);
                    tcs.TrySetResult();
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            }));
            await tcs.Task;
            return;
        }

        await RunUpdateCheckCoreAsync(interactive);
    }

    private async Task RunUpdateCheckCoreAsync(bool interactive)
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

        if (check.Manifest is null)
            return;

        // Never silent-apply mid-shift — balloon + What’s New form.
        if (!interactive)
        {
            try
            {
                _tray.ShowBalloonTip(
                    8000,
                    Ar.UpdateTitle,
                    check.Message,
                    ToolTipIcon.Info);
            }
            catch { /* ignore */ }
        }

        using var form = new UpdateForm(_cfg, check);
        var applied = form.ShowDialog() == DialogResult.OK && form.AppliedOk;
        if (!applied)
        {
            _log.Info("update deferred by operator");
            return;
        }

        _log.Info("update apply started — exiting for restart");
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
            if (!_cfg.PairedConnections().Any())
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
            !_cfg.PairedConnections().Any()
                ? BridgeLinkState.NotPaired
                : BridgeLinkState.Connecting);
    }

    private void DoPair(bool force)
    {
        // First-run: open pair step. Later: connection hub (add / re-pair / reset).
        if (!force && _cfg.PairedConnections().Any())
            return;

        if (force && _cfg.Connections.Count > 0)
        {
            ShowMain();
            _main?.ShowConnections();
            return;
        }

        using var form = new PairForm(_cfg, _log);
        if (form.ShowDialog() == DialogResult.OK && form.PairedOk)
        {
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
