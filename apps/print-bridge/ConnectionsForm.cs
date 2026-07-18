namespace Niha.PrintBridge;

/// <summary>
/// Connection hub: list envs, diagnostics, Re-Pair one env, add env, reset all.
/// Does not delete printers or app settings.
/// </summary>
public sealed class ConnectionsForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly PrintWorker _worker;
    private readonly BridgeLogger _log;
    private readonly FlowLayoutPanel _list;
    private readonly Label _hint;

    public event Action? ConnectionsChanged;

    public ConnectionsForm(BridgeConfig cfg, PrintWorker worker, BridgeLogger log)
    {
        _cfg = cfg;
        _worker = worker;
        _log = log;

        NihaTheme.ApplyForm(this);
        Text = Ar.ManageConnections;
        Width = 580;
        Height = 620;
        FormBorderStyle = FormBorderStyle.Sizable;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        MinimumSize = new Size(520, 480);

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
            Height = 140,
            Padding = new Padding(16, 8, 16, 12),
            BackColor = NihaTheme.Background,
        };

        var addBtn = NihaTheme.PrimaryButton(Ar.AddEnvironment);
        addBtn.Dock = DockStyle.Top;
        addBtn.Height = 40;
        addBtn.Click += (_, _) => RunPair(forceTarget: null);

        var resetBtn = NihaTheme.OutlineButton(Ar.ResetConnections);
        resetBtn.Dock = DockStyle.Top;
        resetBtn.Height = 40;
        resetBtn.Margin = new Padding(0, 8, 0, 0);
        resetBtn.ForeColor = NihaTheme.Danger;
        resetBtn.Click += (_, _) => ResetAll();

        var closeBtn = NihaTheme.OutlineButton(Ar.Close);
        closeBtn.Dock = DockStyle.Bottom;
        closeBtn.Height = 36;
        closeBtn.Click += (_, _) => Close();

        footer.Controls.Add(addBtn);
        footer.Controls.Add(resetBtn);
        footer.Controls.Add(closeBtn);

        _hint = new Label
        {
            Dock = DockStyle.Top,
            Height = 52,
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
            .OrderBy(c =>
                string.Equals(c.Env, "production", StringComparison.OrdinalIgnoreCase) ? 0 :
                string.Equals(c.Env, "testing", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .ToList();

        if (conns.Count == 0)
        {
            _list.Controls.Add(new Label
            {
                Text = Ar.NoConnections,
                AutoSize = true,
                MaximumSize = new Size(500, 0),
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
        var paired = c.IsPaired;
        var online = paired && diag.LinkOk &&
            c.LastHeartbeatAt is { } hb &&
            (DateTimeOffset.Now - hb).TotalSeconds < 90 &&
            string.IsNullOrWhiteSpace(c.LastError);

        var env = c.Env switch
        {
            "production" => Ar.EnvProduction,
            "testing" => Ar.EnvTesting,
            _ => Ar.EnvUnknown,
        };
        var mark = !paired ? "[—]" : online ? "[ON]" : "[OFF]";
        var rest = string.IsNullOrWhiteSpace(c.RestaurantName) ? Ar.None : c.RestaurantName!;
        var poll = diag.LastPollAt is { } p ? p.ToLocalTime().ToString("HH:mm:ss") : Ar.None;
        var status = !paired ? Ar.NotPaired : online ? Ar.ConnOnline : Ar.ConnOffline;

        var card = NihaTheme.Card();
        card.Width = Math.Max(480, _list.ClientSize.Width - 36);
        card.Height = 250;
        card.Margin = new Padding(0, 0, 0, 10);
        card.Padding = new Padding(12);

        var title = new Label
        {
            Text = $"{mark} {env}" + (c.IsDefault ? $" · {Ar.DefaultBadge}" : "") +
                   (paired ? " ✓" : " ✕"),
            Dock = DockStyle.Top,
            Height = 26,
            Font = NihaTheme.UiFont(11f, FontStyle.Bold),
            ForeColor = online ? NihaTheme.Success : (paired ? NihaTheme.Warning : NihaTheme.Muted),
        };

        var body = new Label
        {
            Text =
                $"{Ar.RestaurantName}: {rest}\n" +
                $"{Ar.Status}: {status}\n" +
                $"{Ar.ConnLastPoll}: {poll}\n" +
                $"{string.Format(Ar.ConnClaimFmt, diag.LastClaimCount)} · " +
                $"{Ar.ConnReceivedTotal}: {diag.JobsReceivedTotal} · {Ar.ConnPrintedTotal}: {diag.JobsPrintedTotal}\n" +
                $"{Ar.ConnPrint}: {(diag.LastPrintOk == true ? Ar.PrintOk : diag.LastPrintOk == false ? Ar.PrintFail : Ar.None)}" +
                $"{(string.IsNullOrWhiteSpace(diag.PrintReason) ? "" : " — " + diag.PrintReason)}\n" +
                $"{Ar.ConnLastError}: {diag.LastError ?? c.LastError ?? Ar.None}\n" +
                $"{Ar.ConnPipeline}: {diag.PipelineSummary}",
            Dock = DockStyle.Top,
            Height = 130,
            Font = NihaTheme.UiFont(9f),
            ForeColor = NihaTheme.Foreground,
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 72,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = true,
        };

        var rePair = NihaTheme.PrimaryButton(Ar.RePairConnection);
        rePair.Width = 120;
        rePair.Height = 32;
        rePair.Click += (_, _) => RePairOne(c);

        var del = NihaTheme.OutlineButton(Ar.DeleteConnection);
        del.Width = 100;
        del.Height = 32;
        del.Click += (_, _) => DeleteOne(c);

        var setDef = NihaTheme.OutlineButton(Ar.SetDefault);
        setDef.Width = 120;
        setDef.Height = 32;
        setDef.Enabled = paired && !c.IsDefault;
        setDef.Click += (_, _) =>
        {
            ConfigStore.SetDefaultConnection(_cfg, c.Id);
            ConnectionsChanged?.Invoke();
            Rebuild();
        };

        actions.Controls.Add(rePair);
        actions.Controls.Add(del);
        actions.Controls.Add(setDef);

        card.Controls.Add(actions);
        card.Controls.Add(body);
        card.Controls.Add(title);
        return card;
    }

    private void RePairOne(BridgeConnection c)
    {
        var env = c.Env switch
        {
            "production" => Ar.EnvProduction,
            "testing" => Ar.EnvTesting,
            _ => Ar.EnvUnknown,
        };
        var r = MessageBox.Show(
            string.Format(Ar.RePairConfirmFmt, env),
            Ar.RePairConnection,
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (r != DialogResult.Yes) return;

        ConfigStore.ClearPairingOnly(_cfg, c.Id);
        _log.Info($"re-pair cleared credentials env={c.Env} id={c.Id}");
        ConnectionsChanged?.Invoke();
        RunPair(forceTarget: c);
        Rebuild();
    }

    private void RunPair(BridgeConnection? forceTarget)
    {
        using var form = new PairForm(_cfg, _log, forceTarget);
        if (form.ShowDialog(this) == DialogResult.OK && form.PairedOk)
        {
            ConnectionsChanged?.Invoke();
            MessageBox.Show(Ar.PairSuccess, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        Rebuild();
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
        _log.Info($"connection deleted env={c.Env} id={c.Id}");
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
        _log.Info("all connections reset");
        ConnectionsChanged?.Invoke();
        MessageBox.Show(Ar.ResetConnectionsDone, Ar.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        Rebuild();
    }
}
