using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace Niha.PrintBridge;

/// <summary>NIHA brand tokens aligned with POS (teal + IBM Plex Sans Arabic).</summary>
public static class NihaTheme
{
    // oklch(0.56 0.1 194) ≈ teal used in src/index.css
    public static readonly Color Primary = Color.FromArgb(0x2F, 0x8F, 0x92);
    public static readonly Color PrimaryDark = Color.FromArgb(0x24, 0x72, 0x75);
    public static readonly Color OnPrimary = Color.White;
    public static readonly Color Background = Color.FromArgb(0xF7, 0xF8, 0xF9);
    public static readonly Color Surface = Color.White;
    public static readonly Color Foreground = Color.FromArgb(0x2A, 0x30, 0x36);
    public static readonly Color Muted = Color.FromArgb(0x6B, 0x73, 0x7C);
    public static readonly Color Border = Color.FromArgb(0xE2, 0xE5, 0xE9);
    public static readonly Color Success = Color.FromArgb(0x2F, 0xA0, 0x64);
    public static readonly Color Danger = Color.FromArgb(0xC0, 0x45, 0x3C);
    public static readonly Color Warning = Color.FromArgb(0xD4, 0xA0, 0x17);

    public static Font UiFont(float size = 10.5f, FontStyle style = FontStyle.Regular)
    {
        foreach (var name in new[] { "IBM Plex Sans Arabic", "Segoe UI", "Tahoma" })
        {
            try { return new Font(name, size, style, GraphicsUnit.Point); }
            catch { /* try next */ }
        }
        return new Font(FontFamily.GenericSansSerif, size, style, GraphicsUnit.Point);
    }

    public static void ApplyForm(Form form)
    {
        form.RightToLeft = RightToLeft.Yes;
        form.RightToLeftLayout = true;
        form.Font = UiFont();
        form.BackColor = Background;
        form.ForeColor = Foreground;
        form.StartPosition = FormStartPosition.CenterScreen;
    }

    public static Button PrimaryButton(string text)
    {
        var b = new Button
        {
            Text = text,
            BackColor = Primary,
            ForeColor = OnPrimary,
            FlatStyle = FlatStyle.Flat,
            Height = 40,
            Font = UiFont(11f, FontStyle.Bold),
            Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderSize = 0;
        return b;
    }

    public static Button OutlineButton(string text)
    {
        var b = new Button
        {
            Text = text,
            BackColor = Surface,
            ForeColor = PrimaryDark,
            FlatStyle = FlatStyle.Flat,
            Height = 36,
            Font = UiFont(10f),
            Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderColor = Primary;
        b.FlatAppearance.BorderSize = 1;
        return b;
    }

    public static Panel Card()
    {
        return new Panel
        {
            BackColor = Surface,
            Padding = new Padding(16),
            Margin = new Padding(0, 0, 0, 12),
        };
    }

    public static Bitmap CreateLogo(int size = 48)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Color.Transparent);
        using (var brush = new SolidBrush(Primary))
            g.FillEllipse(brush, 1, 1, size - 3, size - 3);
        using var font = new Font("Segoe UI", size * 0.28f, FontStyle.Bold, GraphicsUnit.Pixel);
        var sf = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
        };
        using var textBrush = new SolidBrush(OnPrimary);
        g.TextRenderingHint = TextRenderingHint.AntiAlias;
        g.DrawString("N", font, textBrush, new RectangleF(0, 0, size, size), sf);
        return bmp;
    }

    public static Icon CreateAppIcon()
    {
        using var bmp = CreateLogo(32);
        return Icon.FromHandle(bmp.GetHicon());
    }
}
