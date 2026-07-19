using ZXing;
using ZXing.Windows.Compatibility;

namespace Niha.PrintBridge;

/// <summary>
/// Pair / Re-Pair step: paste Pairing Token, QR, or short code (short code OK when re-pairing a known env).
/// </summary>
public sealed class PairForm : Form
{
    private readonly BridgeConfig _cfg;
    private readonly BridgeLogger? _log;
    private readonly BridgeConnection? _forceTarget;
    private readonly TextBox _code;
    private readonly Label _status;
    private readonly TextBox _errorBox;
    private readonly Button _pairBtn;
    private readonly Button _copyErrBtn;
    private bool _busy;
    private PairingHelper.ParsedPair? _pending;
    private string _lastErrorDetail = "";

    public bool PairedOk { get; private set; }

    /// <param name="forceTarget">When set, Re-Pair this connection only (other envs untouched).</param>
    public PairForm(BridgeConfig cfg, BridgeLogger? log = null, BridgeConnection? forceTarget = null)
    {
        _cfg = cfg;
        _log = log;
        _forceTarget = forceTarget;

        NihaTheme.ApplyForm(this);
        Text = forceTarget is null ? Ar.Pair : Ar.RePairConnection;
        Width = 520;
        Height = 560;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var header = BuildHeader();
        header.Dock = DockStyle.Top;
        header.Height = 72;

        var body = new Panel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            BackColor = NihaTheme.Background,
            AutoScroll = true,
        };

        var addingSecond =
            forceTarget is null && cfg.PairedConnections().Any();
        var hintText = forceTarget is not null
            ? string.Format(Ar.RePairHintFmt, EnvName(forceTarget))
            : addingSecond
                ? Ar.PairAddingSecondEnv + "\n" + Ar.PairHint
                : Ar.PairHint;
        var hint = new Label
        {
            Text = hintText,
            AutoSize = false,
            Height = addingSecond ? 88 : 64,
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
            Padding = new Padding(0, 8, 0, 0),
        };

        _code = new TextBox
        {
            Dock = DockStyle.Top,
            Height = 80,
            Font = NihaTheme.UiFont(11f, FontStyle.Bold),
            TextAlign = HorizontalAlignment.Center,
            PlaceholderText = Ar.EnterCode,
            Multiline = true,
            AcceptsReturn = false,
            ScrollBars = ScrollBars.Vertical,
            MaxLength = 0,
        };
        _code.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.Enter && !e.Shift)
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
            Padding = new Padding(0, 10, 0, 0),
        };

        _pairBtn = NihaTheme.PrimaryButton(Ar.Pair);
        _pairBtn.Width = 100;
        _pairBtn.Click += async (_, _) => await DoPairAsync();

        var pasteBtn = NihaTheme.PrimaryButton(Ar.PasteCode);
        pasteBtn.Width = 110;
        pasteBtn.Click += (_, _) => PasteCode();

        var scanBtn = NihaTheme.OutlineButton(Ar.ScanQr);
        scanBtn.Width = 100;
        scanBtn.Click += (_, _) => ScanQrFromClipboard();

        actions.Controls.Add(_pairBtn);
        actions.Controls.Add(pasteBtn);
        actions.Controls.Add(scanBtn);

        var scanHint = new Label
        {
            Text = Ar.ScanQrHint,
            Dock = DockStyle.Top,
            Height = 48,
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

        _errorBox = new TextBox
        {
            Dock = DockStyle.Top,
            Height = 90,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Font = NihaTheme.UiFont(9f),
            ForeColor = NihaTheme.Danger,
            BorderStyle = BorderStyle.FixedSingle,
            Visible = false,
            RightToLeft = RightToLeft.Yes,
        };

        _copyErrBtn = NihaTheme.OutlineButton(Ar.CopyErrorDetails);
        _copyErrBtn.Dock = DockStyle.Top;
        _copyErrBtn.Height = 32;
        _copyErrBtn.Visible = false;
        _copyErrBtn.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(_lastErrorDetail)) return;
            try
            {
                Clipboard.SetText(_lastErrorDetail);
                _status.Text = Ar.ErrorDetailsCopied;
                _status.ForeColor = NihaTheme.Success;
            }
            catch { /* ignore */ }
        };

        if (!PairingHelper.HasCloudDefaults(_cfg, forceTarget: forceTarget))
        {
            _status.Text = Ar.MissingCloudConfigHint;
            _status.ForeColor = NihaTheme.Warning;
        }

        body.Controls.Add(_copyErrBtn);
        body.Controls.Add(_errorBox);
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
            Padding = new Padding(20, 8, 20, 12),
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

    private static string EnvName(BridgeConnection c) => c.Env switch
    {
        "production" => Ar.EnvProduction,
        "testing" => Ar.EnvTesting,
        _ => Ar.EnvUnknown,
    };

    private static Panel BuildHeader()
    {
        var p = new Panel { BackColor = NihaTheme.Primary, Padding = new Padding(16) };
        var logo = new PictureBox
        {
            Image = NihaTheme.CreateLogo(40),
            SizeMode = PictureBoxSizeMode.Zoom,
            Size = new Size(40, 40),
            Dock = DockStyle.Right,
        };
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

    private void ClearError()
    {
        _errorBox.Visible = false;
        _errorBox.Text = "";
        _copyErrBtn.Visible = false;
        _lastErrorDetail = "";
    }

    private void ShowError(string userMessage, string? technicalDetail = null)
    {
        _status.Text = Ar.PairFailed;
        _status.ForeColor = NihaTheme.Danger;
        _errorBox.Text = userMessage;
        _errorBox.Visible = true;
        _copyErrBtn.Visible = true;
        _lastErrorDetail =
            $"NIHA Print Bridge {typeof(PairForm).Assembly.GetName().Version?.ToString(3)}\n" +
            $"Time: {DateTimeOffset.Now:O}\n" +
            $"UserMessage: {userMessage}\n" +
            $"Detail: {technicalDetail ?? userMessage}\n" +
            $"TargetEnv: {(_forceTarget is null ? "(new)" : _forceTarget.Env)}\n" +
            $"TargetUrl: {(_forceTarget?.SupabaseUrl ?? "(none)")}\n";
        _log?.Error($"pair FAIL: {technicalDetail ?? userMessage}");
    }

    private void ApplyPending(PairingHelper.ParsedPair parsed)
    {
        ClearError();
        _pending = parsed;
        // Keep full token in box if it was a payload — easier re-try; show code for short.
        if (!string.IsNullOrWhiteSpace(parsed.Url))
        {
            // Show friendly code + confirm env; pending retains url/anon.
            _code.Text = parsed.Code;
            _status.Text = string.Format(Ar.PairReadyEnvFmt, PairingHelper.EnvLabel(parsed));
            _status.ForeColor = NihaTheme.Success;
        }
        else
        {
            _code.Text = parsed.Code;
            _status.Text = _forceTarget is null ? "" : string.Format(Ar.PairReadyEnvFmt, EnvName(_forceTarget));
            _status.ForeColor = NihaTheme.Muted;
        }
    }

    private void PasteCode()
    {
        try
        {
            if (!Clipboard.ContainsText()) return;
            var text = Clipboard.GetText();
            if (!PairingHelper.TryParseInput(text, out var parsed))
            {
                ShowError(Ar.InvalidCode, "TryParseInput failed for clipboard text");
                return;
            }
            ApplyPending(parsed);
        }
        catch (Exception ex)
        {
            ShowError(Ar.InvalidCode, ex.ToString());
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
            if (result is null || string.IsNullOrWhiteSpace(result.Text) ||
                !PairingHelper.TryParseInput(result.Text, out var parsed))
            {
                ShowError(Ar.InvalidCode, "QR decode/parse failed");
                return;
            }

            ApplyPending(parsed);
        }
        catch (Exception ex)
        {
            ShowError(Ar.InvalidCode, ex.ToString());
        }
    }

    private PairingHelper.ParsedPair? ResolveParsed()
    {
        if (PairingHelper.TryParseInput(_code.Text, out var fromBox) &&
            !string.IsNullOrWhiteSpace(fromBox.Url))
            return fromBox;

        if (_pending is { } pending && !string.IsNullOrWhiteSpace(pending.Url))
        {
            if (string.IsNullOrWhiteSpace(_code.Text) ||
                string.Equals(_code.Text.Trim(), pending.Code, StringComparison.OrdinalIgnoreCase))
                return pending;
        }

        if (PairingHelper.TryParseInput(_code.Text, out var parsed))
            return parsed;

        return _pending;
    }

    private async Task DoPairAsync()
    {
        if (_busy) return;
        ClearError();

        var parsed = ResolveParsed();
        if (parsed is null)
        {
            ShowError(Ar.InvalidCode, "ResolveParsed returned null");
            return;
        }

        if (PairingHelper.RequiresPayloadForSecondEnv(_cfg, parsed, _forceTarget))
        {
            ShowError(Ar.NeedQrForSecondEnv, "RequiresPayloadForSecondEnv");
            return;
        }

        BridgeConnection conn;
        try
        {
            conn = PairingHelper.UpsertConnection(_cfg, parsed, _forceTarget);
        }
        catch (Exception ex)
        {
            ShowError(FriendlyUserMessage(ex.Message), ex.ToString());
            return;
        }

        if (!PairingHelper.HasCloudDefaults(_cfg, parsed, conn))
        {
            ShowError(Ar.MissingCloudConfig, "HasCloudDefaults false after upsert");
            return;
        }

        _busy = true;
        _pairBtn.Enabled = false;
        _status.ForeColor = NihaTheme.Muted;
        _status.Text = Ar.Pairing;
        _log?.Info($"pair start env={conn.Env} urlHost={SafeHost(conn.SupabaseUrl)} codeLen={parsed.Code.Length}");

        try
        {
            var api = new SupabaseBridgeApi(conn);
            var version = typeof(PairForm).Assembly.GetName().Version?.ToString(3) ?? "0.5.7";
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
            conn.LastError = null;

            ConfigStore.Save(_cfg);
            _log?.Info($"pair OK env={conn.Env} bridgeId={conn.BridgeId}");
            PairedOk = true;
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            ShowError(FriendlyUserMessage(ex.Message), ex.ToString());
        }
        finally
        {
            _busy = false;
            _pairBtn.Enabled = true;
        }
    }

    private static string SafeHost(string? url)
    {
        try { return string.IsNullOrWhiteSpace(url) ? "" : new Uri(url).Host; }
        catch { return "(bad-url)"; }
    }

    private static string FriendlyUserMessage(string raw)
    {
        if (raw.Contains("INVALID_CODE", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("invalid_code", StringComparison.OrdinalIgnoreCase))
            return Ar.InvalidCode;
        if (raw.Contains("EXPIRED", StringComparison.OrdinalIgnoreCase))
            return Ar.PairCodeExpired;
        if (raw.Contains("NeedQr", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("بيئة إضافية", StringComparison.Ordinal))
            return Ar.NeedQrForSecondEnv;
        if (raw.Contains("MissingCloud", StringComparison.OrdinalIgnoreCase) ||
            raw.Contains("ملف الإعدادات", StringComparison.Ordinal))
            return Ar.MissingCloudConfig;
        if (raw.Contains("pair_print_bridge failed", StringComparison.OrdinalIgnoreCase))
        {
            // Pull useful server message without dumping huge HTML.
            var idx = raw.IndexOf('{');
            if (idx >= 0)
            {
                var json = raw[idx..];
                if (json.Length > 280) json = json[..280] + "…";
                return $"{Ar.PairFailed}: {json}";
            }
        }
        // Cap UI length but keep copy-buffer full via ShowError technicalDetail.
        var msg = raw.ReplaceLineEndings(" ").Trim();
        return msg.Length > 400 ? msg[..400] + "…" : msg;
    }
}
