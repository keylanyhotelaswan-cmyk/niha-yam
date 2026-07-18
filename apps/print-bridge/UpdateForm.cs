namespace Niha.PrintBridge;

/// <summary>What’s New + progress UI for in-place Bridge updates.</summary>
public sealed class UpdateForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly BridgeUpdater.Manifest _manifest;
    private readonly Label _status;
    private readonly ProgressBar _bar;
    private readonly TextBox _notes;
    private readonly Button _nowBtn;
    private readonly Button _laterBtn;
    private bool _busy;

    /// <summary>True when download+apply script was started successfully.</summary>
    public bool AppliedOk { get; private set; }

    public UpdateForm(BridgeConfig cfg, BridgeUpdater.CheckResult check)
    {
        _cfg = cfg;
        _manifest = check.Manifest ?? throw new ArgumentException("Manifest required", nameof(check));

        NihaTheme.ApplyForm(this);
        Text = Ar.UpdateTitle;
        Width = 480;
        Height = 420;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var current = check.CurrentVersion ?? BridgeUpdater.CurrentVersion;
        var latest = check.LatestVersion ?? _manifest.Version ?? "?";

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 64,
            BackColor = NihaTheme.Primary,
            Padding = new Padding(16),
        };
        var title = new Label
        {
            Text = Ar.UpdateTitle,
            ForeColor = NihaTheme.OnPrimary,
            Font = NihaTheme.UiFont(13f, FontStyle.Bold),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleRight,
        };
        header.Controls.Add(title);

        var body = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            BackColor = NihaTheme.Background,
        };

        var version = new Label
        {
            Text = string.Format(Ar.UpdateAvailableFmt, current, latest),
            Dock = DockStyle.Top,
            Height = 36,
            Font = NihaTheme.UiFont(10.5f, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleRight,
        };

        var notesLabel = new Label
        {
            Text = Ar.UpdateWhatsNew,
            Dock = DockStyle.Top,
            Height = 24,
            Font = NihaTheme.UiFont(9.5f, FontStyle.Bold),
            Padding = new Padding(0, 8, 0, 0),
        };

        _notes = new TextBox
        {
            Dock = DockStyle.Top,
            Height = 140,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Font = NihaTheme.UiFont(9.5f),
            Text = string.IsNullOrWhiteSpace(_manifest.Notes) ? Ar.None : _manifest.Notes.Trim(),
            BorderStyle = BorderStyle.FixedSingle,
            RightToLeft = RightToLeft.Yes,
        };

        _status = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(9f),
            TextAlign = ContentAlignment.MiddleRight,
            Padding = new Padding(0, 8, 0, 0),
        };

        _bar = new ProgressBar
        {
            Dock = DockStyle.Top,
            Height = 22,
            Style = ProgressBarStyle.Continuous,
            Minimum = 0,
            Maximum = 100,
            Value = 0,
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 52,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 8, 0, 0),
        };

        _nowBtn = NihaTheme.PrimaryButton(Ar.UpdateNow);
        _nowBtn.Width = 120;
        _nowBtn.Click += async (_, _) => await ApplyAsync();

        _laterBtn = NihaTheme.OutlineButton(Ar.UpdateLater);
        _laterBtn.Width = 100;
        _laterBtn.Click += (_, _) =>
        {
            if (_busy) return;
            DialogResult = DialogResult.Cancel;
            Close();
        };

        actions.Controls.Add(_nowBtn);
        actions.Controls.Add(_laterBtn);

        body.Controls.Add(actions);
        body.Controls.Add(_bar);
        body.Controls.Add(_status);
        body.Controls.Add(_notes);
        body.Controls.Add(notesLabel);
        body.Controls.Add(version);

        Controls.Add(body);
        Controls.Add(header);
        AcceptButton = _nowBtn;
        CancelButton = _laterBtn;
    }

    private async Task ApplyAsync()
    {
        if (_busy) return;
        _busy = true;
        _nowBtn.Enabled = false;
        _laterBtn.Enabled = false;
        ControlBox = false;

        var progress = new Progress<(string status, int percent)>(p =>
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(() =>
                {
                    _status.ForeColor = NihaTheme.Muted;
                    _status.Text = p.status;
                    _bar.Value = Math.Clamp(p.percent, 0, 100);
                });
                return;
            }
            _status.ForeColor = NihaTheme.Muted;
            _status.Text = p.status;
            _bar.Value = Math.Clamp(p.percent, 0, 100);
        });

        var (ok, msg) = await BridgeUpdater.DownloadAndApplyAsync(_cfg, _manifest, progress);
        if (!ok)
        {
            _busy = false;
            _nowBtn.Enabled = true;
            _laterBtn.Enabled = true;
            ControlBox = true;
            _status.Text = msg;
            _status.ForeColor = NihaTheme.Danger;
            return;
        }

        AppliedOk = true;
        DialogResult = DialogResult.OK;
        Close();
    }
}
