using ZXing;
using ZXing.Windows.Compatibility;

namespace Niha.PrintBridge;

public sealed class PairForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly TextBox _code;
    private readonly Label _status;
    private readonly Button _pairBtn;
    private bool _busy;

    public bool PairedOk { get; private set; }

    public PairForm(BridgeConfig cfg)
    {
        _cfg = cfg;
        NihaTheme.ApplyForm(this);
        Text = Ar.Pair;
        Width = 440;
        Height = 420;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var header = BuildHeader();
        header.Dock = DockStyle.Top;
        header.Height = 72;

        var body = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(24),
            BackColor = NihaTheme.Background,
        };

        var hint = new Label
        {
            Text = Ar.PairHint,
            AutoSize = false,
            Height = 44,
            Dock = DockStyle.Top,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(9.5f),
        };

        var codeLabel = new Label
        {
            Text = Ar.PairCode,
            Dock = DockStyle.Top,
            Height = 24,
            Font = NihaTheme.UiFont(10f, FontStyle.Bold),
            Padding = new Padding(0, 12, 0, 0),
        };

        _code = new TextBox
        {
            Dock = DockStyle.Top,
            Height = 40,
            Font = NihaTheme.UiFont(16f, FontStyle.Bold),
            TextAlign = HorizontalAlignment.Center,
            PlaceholderText = Ar.EnterCode,
            MaxLength = 64,
        };
        _code.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                _ = DoPairAsync();
            }
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 48,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Padding = new Padding(0, 12, 0, 0),
        };

        _pairBtn = NihaTheme.PrimaryButton(Ar.Pair);
        _pairBtn.Width = 120;
        _pairBtn.Click += async (_, _) => await DoPairAsync();

        var scanBtn = NihaTheme.OutlineButton(Ar.ScanQr);
        scanBtn.Width = 120;
        scanBtn.Click += (_, _) => ScanQrFromClipboard();

        var pasteBtn = NihaTheme.OutlineButton(Ar.PasteCode);
        pasteBtn.Width = 120;
        pasteBtn.Click += (_, _) => PasteCode();

        actions.Controls.Add(_pairBtn);
        actions.Controls.Add(scanBtn);
        actions.Controls.Add(pasteBtn);

        var scanHint = new Label
        {
            Text = Ar.ScanQrHint,
            Dock = DockStyle.Top,
            Height = 40,
            ForeColor = NihaTheme.Muted,
            Font = NihaTheme.UiFont(8.5f),
        };

        _status = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = NihaTheme.Muted,
            TextAlign = ContentAlignment.MiddleCenter,
        };

        if (!PairingHelper.HasCloudDefaults(_cfg))
        {
            _status.Text = Ar.MissingCloudConfig;
            _status.ForeColor = NihaTheme.Danger;
            _pairBtn.Enabled = false;
        }

        // Add in reverse for Dock Top
        body.Controls.Add(_status);
        body.Controls.Add(scanHint);
        body.Controls.Add(actions);
        body.Controls.Add(_code);
        body.Controls.Add(codeLabel);
        body.Controls.Add(hint);

        var footer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 56,
            Padding = new Padding(24, 8, 24, 12),
            BackColor = NihaTheme.Background,
        };
        var cancel = NihaTheme.OutlineButton(Ar.Cancel);
        cancel.Dock = DockStyle.Left;
        cancel.Width = 100;
        cancel.Click += (_, _) =>
        {
            DialogResult = DialogResult.Cancel;
            Close();
        };
        footer.Controls.Add(cancel);

        Controls.Add(body);
        Controls.Add(footer);
        Controls.Add(header);
        AcceptButton = _pairBtn;
    }

    private static Panel BuildHeader()
    {
        var p = new Panel { BackColor = NihaTheme.Primary, Padding = new Padding(16) };
        var logo = new PictureBox
        {
            Image = NihaTheme.CreateLogo(40),
            SizeMode = PictureBoxSizeMode.Zoom,
            Size = new Size(40, 40),
            Location = new Point(16, 16),
        };
        // RTL: place logo on the right visually via Dock
        logo.Dock = DockStyle.Right;
        var title = new Label
        {
            Text = Ar.AppTitle,
            ForeColor = NihaTheme.OnPrimary,
            Font = NihaTheme.UiFont(13f, FontStyle.Bold),
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleRight,
            Padding = new Padding(0, 0, 12, 0),
        };
        p.Controls.Add(title);
        p.Controls.Add(logo);
        return p;
    }

    private void PasteCode()
    {
        try
        {
            if (!Clipboard.ContainsText()) return;
            var text = Clipboard.GetText();
            if (!PairingHelper.TryParseInput(text, out var parsed))
            {
                _status.Text = Ar.InvalidCode;
                _status.ForeColor = NihaTheme.Danger;
                return;
            }
            // Show only the code — never JSON
            _code.Text = parsed.Code;
            PairingHelper.UpsertConnection(_cfg, parsed);
            _status.Text = "";
        }
        catch
        {
            _status.Text = Ar.InvalidCode;
            _status.ForeColor = NihaTheme.Danger;
        }
    }

    private void ScanQrFromClipboard()
    {
        try
        {
            if (!Clipboard.ContainsImage())
            {
                _status.Text = Ar.ScanQrHint;
                _status.ForeColor = NihaTheme.Warning;
                return;
            }

            using var img = (Bitmap)Clipboard.GetImage()!;
            var reader = new BarcodeReader
            {
                AutoRotate = true,
                Options = { TryHarder = true, PossibleFormats = [BarcodeFormat.QR_CODE] },
            };
            var result = reader.Decode(img);
            if (result is null || string.IsNullOrWhiteSpace(result.Text))
            {
                _status.Text = Ar.InvalidCode;
                _status.ForeColor = NihaTheme.Danger;
                return;
            }

            if (!PairingHelper.TryParseInput(result.Text, out var parsed))
            {
                _status.Text = Ar.InvalidCode;
                _status.ForeColor = NihaTheme.Danger;
                return;
            }

            _code.Text = parsed.Code;
            PairingHelper.UpsertConnection(_cfg, parsed);
            _status.Text = "";
            _status.ForeColor = NihaTheme.Muted;
        }
        catch (Exception ex)
        {
            _status.Text = ex.Message;
            _status.ForeColor = NihaTheme.Danger;
        }
    }

    private async Task DoPairAsync()
    {
        if (_busy) return;
        if (!PairingHelper.TryParseInput(_code.Text, out var parsed))
        {
            // Also try applying clipboard-style if user typed JSON somehow — still only show code
            _status.Text = Ar.InvalidCode;
            _status.ForeColor = NihaTheme.Danger;
            return;
        }

        var conn = PairingHelper.UpsertConnection(_cfg, parsed);
        if (!PairingHelper.HasCloudDefaults(_cfg, parsed))
        {
            _status.Text = Ar.MissingCloudConfig;
            _status.ForeColor = NihaTheme.Danger;
            return;
        }

        _busy = true;
        _pairBtn.Enabled = false;
        _status.ForeColor = NihaTheme.Muted;
        _status.Text = Ar.Pairing;

        try
        {
            var api = new SupabaseBridgeApi(conn);
            var version = typeof(PairForm).Assembly.GetName().Version?.ToString() ?? "0.5.0";
            var result = await api.PairAsync(
                parsed.Code,
                Environment.MachineName,
                Environment.MachineName,
                Environment.UserName,
                version,
                CancellationToken.None);

            conn.BridgeToken = result.GetProperty("token").GetString();
            conn.BridgeId = result.GetProperty("bridge_id").GetString();
            if (result.TryGetProperty("restaurant_id", out var rid))
                conn.RestaurantId = rid.GetString();
            if (result.TryGetProperty("restaurant_name", out var rn) &&
                !string.IsNullOrWhiteSpace(rn.GetString()))
                conn.RestaurantName = rn.GetString();
            conn.Env = BridgeConnection.DetectEnv(conn.SupabaseUrl);
            // Do not invent a placeholder name — wait for heartbeat if missing

            ConfigStore.Save(_cfg);
            PairedOk = true;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            _status.Text = $"{Ar.PairFailed}: {FriendlyError(ex.Message)}";
            _status.ForeColor = NihaTheme.Danger;
        }
        finally
        {
            _busy = false;
            _pairBtn.Enabled = true;
        }
    }

    private static string FriendlyError(string raw)
    {
        if (raw.Contains("INVALID_CODE", StringComparison.OrdinalIgnoreCase))
            return Ar.InvalidCode;
        return raw.Length > 120 ? raw[..120] + "…" : raw;
    }
}
