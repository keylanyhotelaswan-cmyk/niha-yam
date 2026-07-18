using System.Drawing.Printing;

namespace Niha.PrintBridge;

public sealed class MainForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly BridgeLogger _log;
    private readonly PrintWorker _worker;
    private readonly NotifyIcon _tray;
    private readonly TrayApplicationContext _app;

    private readonly Label _linkStatus;
    private readonly Label _activityStatus;
    private readonly Label _lastStage;
    private readonly Label _pairStatus;
    private readonly Label _device;
    private readonly Label _restaurant;
    private readonly Label _lastPrint;
    private readonly ListBox _printers;
    private readonly Panel _advancedPanel;
    private Label _advVersion = null!;
    private Label _advBridgeId = null!;
    private Label _advHeartbeat = null!;
    private Label _advLastClaim = null!;
    private Label _advInstallPath = null!;
    private Label _advDataPath = null!;
    private readonly Button _advancedToggle;
    private bool _advancedOpen;
    private CheckBox _chkAutostart = null!;
    private CheckBox _chkAutoUpdate = null!;
    private Label _updateStatus = null!;
    private bool _settingsSyncing;
    private BridgeLinkState _lastLinkState = BridgeLinkState.Connecting;

    public MainForm(
        BridgeConfig cfg,
        BridgeLogger log,
        PrintWorker worker,
        NotifyIcon tray,
        TrayApplicationContext app)
    {
        _cfg = cfg;
        _log = log;
        _worker = worker;
        _tray = tray;
        _app = app;

        NihaTheme.ApplyForm(this);
        Text = Ar.AppTitle;
        Width = 520;
        Height = 720;
        MinimumSize = new Size(480, 620);

        try { Icon = NihaTheme.CreateAppIcon(); } catch { /* ignore */ }

        var root = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16), AutoScroll = true };

        var header = BuildHeader();
        header.Dock = DockStyle.Top;
        header.Height = 64;

        var statusCard = NihaTheme.Card();
        statusCard.Dock = DockStyle.Top;
        statusCard.Height = 340;
        statusCard.Padding = new Padding(16);
        PaintBorder(statusCard);

        _linkStatus = Row(statusCard, Ar.Status, Ar.Connecting, 8);
        _activityStatus = Row(statusCard, Ar.Activity, Ar.ActivityIdle, 36);
        _lastStage = Row(statusCard, Ar.LastStage, Ar.None, 68, multiline: true);
        _pairStatus = Row(statusCard, Ar.Paired, Ar.NotPaired, 148);
        _device = Row(statusCard, Ar.DeviceName, Environment.MachineName, 180);
        _restaurant = Row(statusCard, Ar.ConnectionsTitle, FormatEnvironments(), 212, multiline: true);
        // Taller value so Claim/Reason lines fit per env
        _restaurant.Height = 96;

        var printersCard = NihaTheme.Card();
        printersCard.Dock = DockStyle.Top;
        printersCard.Height = 210;
        printersCard.Padding = new Padding(16);
        PaintBorder(printersCard);
        var printersTitle = new Label
        {
            Text = Ar.PrintersDiscovered,
            Font = NihaTheme.UiFont(11f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 28,
        };
        var showVirtual = new CheckBox
        {
            Text = Ar.ShowVirtualPrinters,
            Checked = _cfg.ShowVirtualPrinters,
            Dock = DockStyle.Bottom,
            Height = 28,
            Font = NihaTheme.UiFont(8.5f),
            ForeColor = NihaTheme.Muted,
            AutoSize = false,
        };
        showVirtual.CheckedChanged += (_, _) =>
        {
            _cfg.ShowVirtualPrinters = showVirtual.Checked;
            ConfigStore.Save(_cfg);
            LoadPrinters();
        };
        _printers = new ListBox
        {
            Dock = DockStyle.Fill,
            Font = NihaTheme.UiFont(10f),
            BorderStyle = BorderStyle.FixedSingle,
            IntegralHeight = false,
        };
        printersCard.Controls.Add(_printers);
        printersCard.Controls.Add(showVirtual);
        printersCard.Controls.Add(printersTitle);

        var lastCard = NihaTheme.Card();
        lastCard.Dock = DockStyle.Top;
        lastCard.Height = 72;
        lastCard.Padding = new Padding(16);
        PaintBorder(lastCard);
        var lastTitle = new Label
        {
            Text = Ar.LastPrint,
            Font = NihaTheme.UiFont(10f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 22,
        };
        _lastPrint = new Label
        {
            Text = FormatLastPrint(),
            Dock = DockStyle.Fill,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(9.5f),
        };
        lastCard.Controls.Add(_lastPrint);
        lastCard.Controls.Add(lastTitle);

        var settingsCard = BuildSettingsCard();

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 96,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = true,
            Padding = new Padding(0, 8, 0, 0),
        };

        var openPc = NihaTheme.PrimaryButton(Ar.OpenPrintCenter);
        openPc.Width = 160;
        openPc.Click += (_, _) => OpenPrintCenter();
        openPc.Visible = !string.IsNullOrWhiteSpace(_cfg.PrintCenterUrl);

        var rePair = NihaTheme.OutlineButton(Ar.RePair);
        rePair.Width = 130;
        rePair.Click += (_, _) => RequestRePair();

        var manageConn = NihaTheme.OutlineButton(Ar.ManageConnections);
        manageConn.Width = 140;
        manageConn.Click += (_, _) => ShowConnections();

        var about = NihaTheme.OutlineButton(Ar.About);
        about.Width = 120;
        about.Click += (_, _) => ShowAbout();

        actions.Controls.Add(openPc);
        actions.Controls.Add(rePair);
        actions.Controls.Add(manageConn);
        actions.Controls.Add(about);

        var adminHint = new Label
        {
            Text = Ar.AdminHint,
            Dock = DockStyle.Top,
            Height = 40,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(8.5f),
        };

        _advancedToggle = NihaTheme.OutlineButton(Ar.Advanced);
        _advancedToggle.Dock = DockStyle.Top;
        _advancedToggle.Height = 36;
        _advancedToggle.Click += (_, _) => ToggleAdvanced();

        _advancedPanel = BuildAdvanced();
        _advancedPanel.Dock = DockStyle.Top;
        _advancedPanel.Visible = false;
        _advancedPanel.Height = 320;

        var stack = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 8,
            AutoSize = true,
        };
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        stack.Controls.Add(statusCard, 0, 0);
        stack.Controls.Add(adminHint, 0, 1);
        stack.Controls.Add(printersCard, 0, 2);
        stack.Controls.Add(lastCard, 0, 3);
        stack.Controls.Add(settingsCard, 0, 4);
        stack.Controls.Add(actions, 0, 5);
        stack.Controls.Add(_advancedToggle, 0, 6);
        stack.Controls.Add(_advancedPanel, 0, 7);

        root.Controls.Add(stack);
        Controls.Add(root);
        Controls.Add(header);

        LoadPrinters();
        RefreshStatus(BridgeLinkState.Connecting);
        RefreshActivity();
        _worker.StateChanged += OnWorkerState;
        _worker.ActivityChanged += OnWorkerActivity;
        _worker.PrintFinished += OnPrintFinished;

        FormClosing += (_, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
            }
        };
    }

    public event Action? RePairRequested;

    public void SyncSettingsUi()
    {
        if (_chkAutostart is null || _chkAutoUpdate is null) return;
        _settingsSyncing = true;
        try
        {
            _chkAutostart.Checked = _cfg.StartWithWindows;
            _chkAutoUpdate.Checked = _cfg.AutoUpdate;
        }
        finally
        {
            _settingsSyncing = false;
        }
    }

    private Panel BuildSettingsCard()
    {
        var card = NihaTheme.Card();
        card.Dock = DockStyle.Top;
        card.Height = 150;
        card.Padding = new Padding(16);
        PaintBorder(card);

        var title = new Label
        {
            Text = Ar.Settings,
            Font = NihaTheme.UiFont(11f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 26,
        };

        _chkAutostart = new CheckBox
        {
            Text = Ar.StartWithWindows,
            Checked = _cfg.StartWithWindows,
            Dock = DockStyle.Top,
            Height = 28,
            Font = NihaTheme.UiFont(9.5f),
            AutoSize = false,
        };
        _chkAutostart.CheckedChanged += (_, _) =>
        {
            if (_settingsSyncing) return;
            _cfg.StartWithWindows = _chkAutostart.Checked;
            _cfg.StartWithWindowsInitialized = true;
            Autostart.SetEnabled(_cfg.StartWithWindows);
            ConfigStore.Save(_cfg);
        };

        _chkAutoUpdate = new CheckBox
        {
            Text = Ar.AutoUpdate,
            Checked = _cfg.AutoUpdate,
            Dock = DockStyle.Top,
            Height = 28,
            Font = NihaTheme.UiFont(9.5f),
            AutoSize = false,
        };
        _chkAutoUpdate.CheckedChanged += (_, _) =>
        {
            if (_settingsSyncing) return;
            _cfg.AutoUpdate = _chkAutoUpdate.Checked;
            ConfigStore.Save(_cfg);
        };

        var row = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 40,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
        };
        var checkBtn = NihaTheme.OutlineButton(Ar.CheckUpdate);
        checkBtn.Width = 140;
        checkBtn.Click += async (_, _) =>
        {
            checkBtn.Enabled = false;
            _updateStatus.Text = "…";
            try
            {
                await _app.RunUpdateCheckAsync(interactive: true);
                var r = await BridgeUpdater.CheckAsync(_cfg);
                if (!IsDisposed)
                {
                    _updateStatus.Text = r.Message;
                    _updateStatus.ForeColor = r.UpdateAvailable ? NihaTheme.Primary : NihaTheme.Muted;
                }
            }
            catch
            {
                // App may exit mid-update
            }
            finally
            {
                if (!IsDisposed) checkBtn.Enabled = true;
            }
        };
        row.Controls.Add(checkBtn);

        _updateStatus = new Label
        {
            Text = string.Format(Ar.UpdateUpToDateFmt, BridgeUpdater.CurrentVersion),
            Dock = DockStyle.Fill,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(8.5f),
            TextAlign = ContentAlignment.MiddleRight,
        };

        card.Controls.Add(_updateStatus);
        card.Controls.Add(row);
        card.Controls.Add(_chkAutoUpdate);
        card.Controls.Add(_chkAutostart);
        card.Controls.Add(title);
        return card;
    }

    private Panel BuildHeader()
    {
        var p = new Panel { BackColor = NihaTheme.Primary };
        var logo = new PictureBox
        {
            Image = NihaTheme.CreateLogo(40),
            SizeMode = PictureBoxSizeMode.Zoom,
            Size = new Size(40, 40),
            Dock = DockStyle.Right,
            Margin = new Padding(12),
        };
        var titles = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12, 10, 12, 10) };
        var ver = typeof(MainForm).Assembly.GetName().Version?.ToString(3) ?? "0.3.13";
        var t1 = new Label
        {
            Text = Ar.AppTitle,
            ForeColor = NihaTheme.OnPrimary,
            Font = NihaTheme.UiFont(12f, FontStyle.Bold),
            Dock = DockStyle.Top,
            Height = 24,
            TextAlign = ContentAlignment.MiddleRight,
        };
        var t2 = new Label
        {
            Text = $"{Ar.AppSubtitle} · v{ver}",
            ForeColor = Color.FromArgb(230, 255, 255, 255),
            Font = NihaTheme.UiFont(9f),
            Dock = DockStyle.Top,
            Height = 20,
            TextAlign = ContentAlignment.MiddleRight,
        };
        Text = $"{Ar.AppTitle} · v{ver}";
        titles.Controls.Add(t2);
        titles.Controls.Add(t1);
        p.Controls.Add(titles);
        p.Controls.Add(logo);
        return p;
    }

    private Panel BuildAdvanced()
    {
        var p = NihaTheme.Card();
        PaintBorder(p);
        p.Padding = new Padding(16);
        var note = new Label
        {
            Text = Ar.TechNote,
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(8.5f),
        };
        var installDir = Path.GetDirectoryName(Application.ExecutablePath) ?? AppContext.BaseDirectory;
        _advVersion = Row(p, Ar.Version, typeof(MainForm).Assembly.GetName().Version?.ToString(3) ?? "0.5.3", 36);
        _advBridgeId = Row(p, Ar.BridgeId, ShortId(_cfg.BridgeId), 68);
        _advHeartbeat = Row(p, Ar.Heartbeat, Ar.None, 100);
        _advLastClaim = Row(p, Ar.LastClaim, _worker.LastClaimSummary, 132, multiline: true);
        _advInstallPath = Row(p, Ar.InstallPath, installDir, 180, multiline: true);
        _advDataPath = Row(p, Ar.DataPath, ConfigStore.Dir, 228, multiline: true);

        var openLogs = NihaTheme.OutlineButton(Ar.OpenLogs);
        openLogs.Dock = DockStyle.Bottom;
        openLogs.Height = 32;
        openLogs.Click += (_, _) =>
        {
            Directory.CreateDirectory(ConfigStore.Dir);
            System.Diagnostics.Process.Start("explorer.exe", ConfigStore.Dir);
        };

        var localTest = NihaTheme.OutlineButton(Ar.TestPrint);
        localTest.Dock = DockStyle.Bottom;
        localTest.Height = 32;
        localTest.Click += (_, _) =>
        {
            if (_printers.SelectedItem is PrinterListItem item &&
                !string.IsNullOrWhiteSpace(item.Name))
            {
                try
                {
                    LocalTestPrint.Run(item.Name);
                    MessageBox.Show(Ar.PrintOk, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"{Ar.PrintFail}\n{ex.Message}", Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            else
            {
                MessageBox.Show(Ar.SelectPrinter, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        };

        p.Controls.Add(localTest);
        p.Controls.Add(openLogs);
        p.Controls.Add(note);
        p.Height = 320;
        return p;
    }

    private static Label Row(
        Control parent,
        string label,
        string value,
        int top,
        bool multiline = false)
    {
        var l = new Label
        {
            Text = label,
            Left = 16,
            Top = top,
            Width = 120,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(9f),
        };
        var v = new Label
        {
            Text = value,
            Left = 140,
            Top = top,
            Width = 320,
            Font = NihaTheme.UiFont(10f, FontStyle.Bold),
            AutoEllipsis = !multiline,
            AutoSize = false,
            Height = multiline ? 72 : 22,
        };
        parent.Controls.Add(l);
        parent.Controls.Add(v);
        return v;
    }

    private static void PaintBorder(Panel panel)
    {
        panel.Paint += (_, e) =>
        {
            using var pen = new Pen(NihaTheme.Border);
            e.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
        };
    }

    private void LoadPrinters()
    {
        _printers.Items.Clear();
        try
        {
            var installed = PrinterSettings.InstalledPrinters.Cast<string>();
            foreach (var name in PrinterFilter.Filter(installed, _cfg.ShowVirtualPrinters))
            {
                var label = PrinterFilter.IsVirtual(name)
                    ? $"{name}  ({Ar.VirtualTag})"
                    : name;
                _printers.Items.Add(new PrinterListItem(name, label));
            }
        }
        catch
        {
            /* ignore */
        }

        if (_printers.Items.Count == 0)
            _printers.Items.Add(new PrinterListItem("", Ar.NoPrinters));
        else
            _printers.SelectedIndex = 0;
    }

    private sealed record PrinterListItem(string Name, string Label)
    {
        public override string ToString() => Label;
    }

    private void ToggleAdvanced()
    {
        _advancedOpen = !_advancedOpen;
        _advancedPanel.Visible = _advancedOpen;
        _advancedToggle.Text = _advancedOpen ? Ar.HideAdvanced : Ar.Advanced;
        _advBridgeId.Text = ShortId(_cfg.BridgeId);
        _advHeartbeat.Text = _cfg.LastHeartbeatAt is { } hb
            ? hb.ToLocalTime().ToString("g")
            : Ar.None;
    }

    private void OnWorkerState(BridgeLinkState state)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            RefreshStatus(state);
            RefreshActivity();
        });
    }

    private void OnWorkerActivity()
    {
        if (IsDisposed) return;
        BeginInvoke(RefreshActivity);
    }

    private void RefreshActivity()
    {
        _activityStatus.Text = _worker.Activity switch
        {
            BridgeActivity.WaitingForJobs => Ar.ActivityWaiting,
            BridgeActivity.Claiming => Ar.ActivityClaiming,
            BridgeActivity.ProcessingJob => Ar.ActivityProcessing,
            BridgeActivity.Rendering => Ar.ActivityRendering,
            BridgeActivity.Printing => Ar.ActivityPrinting,
            BridgeActivity.Reporting => Ar.ActivityReporting,
            _ => Ar.ActivityIdle,
        };
        _activityStatus.ForeColor = _worker.Activity switch
        {
            BridgeActivity.WaitingForJobs => NihaTheme.Success,
            BridgeActivity.Idle => NihaTheme.Muted,
            BridgeActivity.Claiming => NihaTheme.Muted,
            _ => NihaTheme.Warning,
        };

        var stage = PrintStageLabels.En(_worker.LastStage);
        var detail = string.IsNullOrWhiteSpace(_worker.LastStageDetail)
            ? Ar.None
            : _worker.LastStageDetail;
        _lastStage.Text = detail == Ar.None ? stage : $"{stage} · {detail}";
        _lastStage.ForeColor = _worker.LastStage == PrintStage.Failed
            ? NihaTheme.Danger
            : NihaTheme.Muted;
    }

    private void OnPrintFinished(bool ok, string summary)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _cfg.LastPrintOk = ok;
            _cfg.LastPrintSummary = summary;
            _cfg.LastPrintAt = DateTimeOffset.Now;
            ConfigStore.Save(_cfg);
            _lastPrint.Text = FormatLastPrint();
            _lastPrint.ForeColor = ok ? NihaTheme.Success : NihaTheme.Danger;
        });
    }

    public void ShowAbout()
    {
        using var form = new AboutForm(_cfg, _worker, _lastLinkState);
        form.ShowDialog(this);
    }

    public void ShowConnections()
    {
        using var form = new ConnectionsForm(_cfg, _worker, _log);
        form.ConnectionsChanged += () =>
        {
            RefreshStatus(_lastLinkState);
            RefreshActivity();
        };
        form.ShowDialog(this);
        RefreshStatus(
            _cfg.PairedConnections().Any()
                ? BridgeLinkState.Connected
                : BridgeLinkState.NotPaired);
    }

    public void RefreshStatus(BridgeLinkState state)
    {
        _lastLinkState = state;
        var paired = _cfg.PairedConnections().Any();
        _pairStatus.Text = paired ? Ar.Paired : Ar.NotPaired;
        _pairStatus.ForeColor = paired ? NihaTheme.Success : NihaTheme.Warning;
        _restaurant.Text = FormatEnvironments();
        _device.Text = Environment.MachineName;

        _linkStatus.Text = state switch
        {
            BridgeLinkState.NotPaired => Ar.NotPaired,
            BridgeLinkState.Connecting => Ar.Connecting,
            BridgeLinkState.Connected => Ar.Connected,
            BridgeLinkState.Disconnected => Ar.Disconnected,
            _ => Ar.Disconnected,
        };
        _linkStatus.ForeColor = state switch
        {
            BridgeLinkState.Connected => NihaTheme.Success,
            BridgeLinkState.Connecting => NihaTheme.Warning,
            BridgeLinkState.NotPaired => NihaTheme.Muted,
            _ => NihaTheme.Danger,
        };

        _tray.Text = paired ? Ar.TrayPaired : Ar.TrayNotPaired;
        if (_advancedOpen)
        {
            _advBridgeId.Text = ShortId(_cfg.BridgeId);
            _advHeartbeat.Text = _cfg.LastHeartbeatAt is { } hb
                ? hb.ToLocalTime().ToString("g")
                : Ar.None;
            _advLastClaim.Text = _worker.LastClaimSummary;
        }
    }

    private string FormatLastPrint()
    {
        if (_cfg.LastPrintAt is null) return Ar.None;
        var mark = _cfg.LastPrintOk == true ? Ar.PrintOk : Ar.PrintFail;
        return $"{mark} · {_cfg.LastPrintSummary} · {_cfg.LastPrintAt.Value.ToLocalTime():g}";
    }

    private string FormatEnvironments()
    {
        var parts = _cfg.PairedConnections()
            .OrderBy(c =>
                string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase) ? 0 :
                string.Equals(c.Env, "testing", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .Select(c =>
            {
                var env = c.Env switch
                {
                    "production" => Ar.EnvProduction,
                    "testing" => Ar.EnvTesting,
                    _ => Ar.EnvUnknown,
                };
                var diag = _worker.GetConnDiag(c);
                var online = diag.LinkOk &&
                    c.LastHeartbeatAt is { } hb &&
                    (DateTimeOffset.Now - hb).TotalSeconds < 90 &&
                    string.IsNullOrWhiteSpace(c.LastError);
                var mark = online ? "[ON]" : "[OFF]";
                var name = string.IsNullOrWhiteSpace(c.RestaurantName)
                    ? ""
                    : $" — {c.RestaurantName}";
                var claim = diag.LastClaimCount > 0
                    ? $"Claim:{diag.LastClaimCount}"
                    : "Claim:0";
                var reason = diag.LastClaimCount == 0 && !string.IsNullOrWhiteSpace(diag.ClaimReason)
                    ? diag.ClaimReason
                    : diag.PrintReason ?? diag.PipelineSummary;
                return $"{mark} {env}{name} · {claim} · {reason}";
            })
            .ToList();
        if (parts.Count == 0) return Ar.None;
        return string.Join(Environment.NewLine, parts);
    }

    private void RequestRePair()
    {
        var r = MessageBox.Show(
            Ar.RePair + "؟",
            Ar.AppTitle,
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (r == DialogResult.Yes)
            RePairRequested?.Invoke();
    }

    private void OpenPrintCenter()
    {
        if (string.IsNullOrWhiteSpace(_cfg.PrintCenterUrl)) return;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = _cfg.PrintCenterUrl,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string ShortId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return Ar.None;
        return id.Length <= 12 ? id : id[..8] + "…";
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _worker.StateChanged -= OnWorkerState;
            _worker.ActivityChanged -= OnWorkerActivity;
            _worker.PrintFinished -= OnPrintFinished;
        }
        base.Dispose(disposing);
    }
}
