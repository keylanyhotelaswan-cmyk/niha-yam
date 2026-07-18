namespace Niha.PrintBridge;

/// <summary>Manage saved Production/Testing connections without deleting app settings.</summary>
public sealed class ConnectionsForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly PrintWorker _worker;
    private readonly Action _requestRePair;
    private readonly FlowLayoutPanel _list;
    private readonly Label _hint;

    public event Action? ConnectionsChanged;

    public ConnectionsForm(BridgeConfig cfg, PrintWorker worker, Action requestRePair)
    {
        _cfg = cfg;
        _worker = worker;
        _requestRePair = requestRePair;

        NihaTheme.ApplyForm(this);
        Text = Ar.ManageConnections;
        Width = 560;
        Height = 560;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 64,
            BackColor = NihaTheme.Primary,
            Padding = new Padding(16),
        };
        var title = new Label
        {
            Text = Ar.ManageConnections,
            ForeColor = NihaTheme.OnPrimary,
            Font = NihaTheme.UiFont(13f, FontStyle.Bold),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleRight,
        };
        header.Controls.Add(title);

        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 100,
            Padding = new Padding(16, 8, 16, 12),
            BackColor = NihaTheme.Background,
        };

        var resetBtn = NihaTheme.OutlineButton(Ar.ResetConnections);
        resetBtn.Dock = DockStyle.Top;
        resetBtn.Height = 40;
        resetBtn.ForeColor = NihaTheme.Danger;
        resetBtn.Click += (_, _) => ResetAll();

        var closeBtn = NihaTheme.OutlineButton(Ar.Close);
        closeBtn.Dock = DockStyle.Bottom;
        closeBtn.Height = 36;
        closeBtn.Click += (_, _) => Close();

        footer.Controls.Add(resetBtn);
        footer.Controls.Add(closeBtn);

        _hint = new Label
        {
            Dock = DockStyle.Top,
            Height = 44,
            Padding = new Padding(16, 8, 16, 0),
            Text = Ar.ManageConnectionsHint,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(9f),
        };

        _list = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Padding = new Padding(12),
            BackColor = NihaTheme.Background,
        };

        Controls.Add(_list);
        Controls.Add(_hint);
        Controls.Add(footer);
        Controls.Add(header);

        Rebuild();
    }

    private void Rebuild()
    {
        _list.SuspendLayout();
        _list.Controls.Clear();
        ConfigStore.Normalize(_cfg);

        var conns = _cfg.Connections
            .OrderBy(c => c.IsDefault ? 0 : 1)
            .ThenBy(c =>
                string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase) ? 0 :
                string.Equals(c.Env, "testing", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .ToList();

        if (conns.Count == 0)
        {
            _list.Controls.Add(new Label
            {
                Text = Ar.NoConnections,
                AutoSize = true,
                ForeColor = NihaTheme.Muted,
                Font = NihaTheme.UiFont(10f),
                Margin = new Padding(8),
            });
        }
        else
        {
            foreach (var c in conns)
                _list.Controls.Add(BuildCard(c));
        }

        _list.ResumeLayout();
    }

    private Panel BuildCard(BridgeConnection c)
    {
        var diag = _worker.GetConnDiag(c);
        var online = c.IsPaired && diag.LinkOk &&
            c.LastHeartbeatAt is { } hb &&
            (DateTimeOffset.Now - hb).TotalSeconds < 90 &&
            string.IsNullOrWhiteSpace(c.LastError);

        var env = c.Env switch
        {
            "production" => Ar.EnvProduction,
            "testing" => Ar.EnvTesting,
            _ => Ar.EnvUnknown,
        };
        var mark = online ? "[ON]" : "[OFF]";
        var rest = string.IsNullOrWhiteSpace(c.RestaurantName) ? Ar.None : c.RestaurantName!;
        var poll = diag.LastPollAt is { } p ? p.ToLocalTime().ToString("HH:mm:ss") : Ar.None;
        var claimLine = diag.LastClaimCount > 0
            ? string.Format(Ar.ConnClaimFmt, diag.LastClaimCount)
            : $"{Ar.ConnClaimZero}: {diag.ClaimReason ?? Ar.None}";
        var printLine = diag.LastPrintOk switch
        {
            true => $"{Ar.PrintOk}: {diag.PrintReason ?? ""}",
            false => $"{Ar.PrintFail}: {diag.PrintReason ?? ""}",
            null => Ar.None,
        };

        var card = NihaTheme.Card();
        card.Width = _list.ClientSize.Width > 40 ? _list.ClientSize.Width - 36 : 500;
        card.Height = 200;
        card.Margin = new Padding(0, 0, 0, 10);
        card.Padding = new Padding(12);

        var title = new Label
        {
            Text = $"{mark} {env}" + (c.IsDefault ? $" · {Ar.DefaultBadge}" : ""),
            Dock = DockStyle.Top,
            Height = 24,
            Font = NihaTheme.UiFont(11f, FontStyle.Bold),
            ForeColor = online ? NihaTheme.Success : NihaTheme.Muted,
        };
        var body = new Label
        {
            Text =
                $"{Ar.RestaurantName}: {rest}\n" +
                $"{Ar.Status}: {(online ? Ar.ConnOnline : Ar.ConnOffline)}\n" +
                $"{Ar.ConnLastPoll}: {poll}\n" +
                $"{claimLine}\n" +
                $"{Ar.ConnPrint}: {printLine}\n" +
                $"{Ar.ConnPipeline}: {diag.PipelineSummary}",
            Dock = DockStyle.Top,
            Height = 110,
            Font = NihaTheme.UiFont(9f),
            ForeColor = NihaTheme.Foreground,
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 40,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
        };

        var reconnect = NihaTheme.PrimaryButton(Ar.Reconnect);
        reconnect.Width = 110;
        reconnect.Height = 32;
        reconnect.Click += (_, _) =>
        {
            Close();
            _requestRePair();
        };

        var del = NihaTheme.OutlineButton(Ar.DeleteConnection);
        del.Width = 100;
        del.Height = 32;
        del.Click += (_, _) => DeleteOne(c);

        var setDef = NihaTheme.OutlineButton(Ar.SetDefault);
        setDef.Width = 120;
        setDef.Height = 32;
        setDef.Enabled = !c.IsDefault && c.IsPaired;
        setDef.Click += (_, _) =>
        {
            ConfigStore.SetDefaultConnection(_cfg, c.Id);
            ConnectionsChanged?.Invoke();
            Rebuild();
        };

        actions.Controls.Add(reconnect);
        actions.Controls.Add(del);
        actions.Controls.Add(setDef);

        card.Controls.Add(actions);
        card.Controls.Add(body);
        card.Controls.Add(title);
        return card;
    }

    private void DeleteOne(BridgeConnection c)
    {
        var env = c.Env switch
        {
            "production" => Ar.EnvProduction,
            "testing" => Ar.EnvTesting,
            _ => Ar.EnvUnknown,
        };
        var r = MessageBox.Show(
            string.Format(Ar.DeleteConnectionConfirmFmt, env),
            Ar.ManageConnections,
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (r != DialogResult.Yes) return;

        ConfigStore.RemoveConnection(_cfg, c.Id);
        ConnectionsChanged?.Invoke();
        Rebuild();
    }

    private void ResetAll()
    {
        var r = MessageBox.Show(
            Ar.ResetConnectionsConfirm,
            Ar.ResetConnections,
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2);
        if (r != DialogResult.Yes) return;

        ConfigStore.ClearConnectionsOnly(_cfg);
        ConnectionsChanged?.Invoke();
        MessageBox.Show(Ar.ResetConnectionsDone, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        Rebuild();
    }
}
