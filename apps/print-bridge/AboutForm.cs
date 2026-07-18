namespace Niha.PrintBridge;

/// <summary>Simple About dialog for support: version, paths, last contact, copy diagnostics.</summary>
public sealed class AboutForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly PrintWorker _worker;
    private readonly BridgeLinkState _state;
    private readonly Label _copied;

    public AboutForm(BridgeConfig cfg, PrintWorker worker, BridgeLinkState state)
    {
        _cfg = cfg;
        _worker = worker;
        _state = state;

        NihaTheme.ApplyForm(this);
        Text = Ar.AboutTitle;
        Width = 500;
        Height = 440;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;

        var ver = typeof(AboutForm).Assembly.GetName().Version?.ToString(3) ?? "?";
        var install = Path.GetDirectoryName(Application.ExecutablePath) ?? AppContext.BaseDirectory;
        var lastHb = cfg.PairedConnections()
            .Select(c => c.LastHeartbeatAt)
            .Where(t => t is not null)
            .DefaultIfEmpty(null)
            .Max() ?? cfg.LastHeartbeatAt;

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 64,
            BackColor = NihaTheme.Primary,
            Padding = new Padding(16),
        };
        var title = new Label
        {
            Text = Ar.AboutTitle,
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

        var statusAr = state switch
        {
            BridgeLinkState.Connected => Ar.Connected,
            BridgeLinkState.Connecting => Ar.Connecting,
            BridgeLinkState.NotPaired => Ar.NotPaired,
            _ => Ar.Disconnected,
        };

        // Dock Top: add in reverse order
        _copied = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(8.5f),
            TextAlign = ContentAlignment.MiddleCenter,
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 48,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 8, 0, 0),
        };

        var copyBtn = NihaTheme.PrimaryButton(Ar.CopyDiagnostics);
        copyBtn.Width = 180;
        copyBtn.Click += (_, _) => CopyDiagnostics();

        var closeBtn = NihaTheme.OutlineButton(Ar.Close);
        closeBtn.Width = 100;
        closeBtn.Click += (_, _) => Close();

        actions.Controls.Add(copyBtn);
        actions.Controls.Add(closeBtn);

        body.Controls.Add(_copied);
        body.Controls.Add(actions);
        body.Controls.Add(InfoBlock(Ar.InstallPath, install, 56));
        body.Controls.Add(InfoBlock(Ar.DataPath, ConfigStore.Dir, 56));
        body.Controls.Add(InfoBlock(Ar.Heartbeat, lastHb is { } hb ? hb.ToLocalTime().ToString("g") : Ar.None, 44));
        body.Controls.Add(InfoBlock(Ar.Status, statusAr, 44));
        body.Controls.Add(InfoBlock(Ar.Version, ver, 44));

        Controls.Add(body);
        Controls.Add(header);
        AcceptButton = copyBtn;
        CancelButton = closeBtn;
    }

    private static Panel InfoBlock(string label, string value, int height)
    {
        var p = new Panel
        {
            Dock = DockStyle.Top,
            Height = height,
            Padding = new Padding(0, 4, 0, 0),
        };
        var lbl = new Label
        {
            Text = label,
            Dock = DockStyle.Top,
            Height = 18,
            Font = NihaTheme.UiFont(9f, FontStyle.Bold),
            ForeColor = NihaTheme.Muted,
            TextAlign = ContentAlignment.MiddleRight,
        };
        var val = new Label
        {
            Text = string.IsNullOrWhiteSpace(value) ? Ar.None : value,
            Dock = DockStyle.Fill,
            Font = NihaTheme.UiFont(9.5f),
            TextAlign = ContentAlignment.TopRight,
        };
        p.Controls.Add(val);
        p.Controls.Add(lbl);
        return p;
    }

    private void CopyDiagnostics()
    {
        try
        {
            var text = DiagnosticsReport.Build(_cfg, _worker, _state);
            Clipboard.SetText(text);
            _copied.Text = Ar.DiagnosticsCopied;
            _copied.ForeColor = NihaTheme.Success;
        }
        catch (Exception ex)
        {
            _copied.Text = ex.Message;
            _copied.ForeColor = NihaTheme.Danger;
        }
    }
}
