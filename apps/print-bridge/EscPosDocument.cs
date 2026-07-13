using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using ArabicRt;

namespace Niha.PrintBridge;

public enum EscPosAlign
{
    Left,
    Center,
    Right,
}

/// <summary>
/// Arabic-aware ESC/POS builder.
/// Renders Arabic via GDI+ Uniscribe (joined RTL), then sends a widely-supported
/// ESC * bit-image (many cheap printers ignore GS v 0 and dump bytes as text).
/// </summary>
public sealed class EscPosDocument
{
    private readonly MemoryStream _ms = new();
    private readonly int _widthDots;

    public EscPosDocument(int widthDots = 576)
    {
        ArabicEncoding.EnsureRegistered();
        _widthDots = Math.Clamp(widthDots, 384, 576);
        Raw(0x1b, (byte)'@'); // init
        // Fixed line spacing helps ESC * bands land cleanly
        Raw(0x1b, (byte)'3', 24);
    }

    public EscPosDocument Line(
        string text,
        EscPosAlign align = EscPosAlign.Left,
        float fontSize = 22f,
        bool bold = false)
    {
        text ??= "";
        if (string.IsNullOrWhiteSpace(text))
        {
            Feed(1);
            return this;
        }

        // ASCII-only → text mode
        if (!Arabic.ContainsArabic(text))
        {
            Align(align);
            if (bold) Raw(0x1b, (byte)'E', 1);
            Raw(ArabicEncoding.GetBytes(text + "\n"));
            if (bold) Raw(0x1b, (byte)'E', 0);
            return this;
        }

        // Arabic / mixed → raster via ESC * (compatible) after GDI shaping
        Align(EscPosAlign.Left); // bitmap already contains visual alignment
        Raw(RenderArabicLine(text, align, fontSize, bold));
        return this;
    }

    public EscPosDocument Separator() => DashedRule();

    public EscPosDocument DashedRule()
    {
        Align(EscPosAlign.Left);
        var dashes = new string('-', _widthDots >= 576 ? 42 : 32);
        Raw(ArabicEncoding.GetBytes(dashes + "\n"));
        return this;
    }

    public EscPosDocument SolidRule()
    {
        Align(EscPosAlign.Left);
        var line = new string('=', _widthDots >= 576 ? 42 : 32);
        Raw(ArabicEncoding.GetBytes(line + "\n"));
        return this;
    }

    /// <summary>Right + left columns on one raster row (RTL receipts).</summary>
    public EscPosDocument Columns(
        string rightText,
        string leftText,
        float fontSize = 17f,
        bool bold = false)
    {
        rightText ??= "";
        leftText ??= "";
        Align(EscPosAlign.Left);
        Raw(RenderTwoColumnLine(rightText, leftText, fontSize, bold));
        return this;
    }

    /// <summary>Thick bordered block — classic Arabic receipt total/payment boxes.</summary>
    public EscPosDocument Box(IReadOnlyList<(string Text, float FontSize, bool Bold)> lines, int border = 3)
    {
        if (lines.Count == 0) return this;
        Align(EscPosAlign.Left);
        Raw(RenderBox(lines, border));
        return this;
    }

    public EscPosDocument Feed(int lines = 1)
    {
        for (var i = 0; i < lines; i++)
            Raw(0x0a);
        return this;
    }

    /// <summary>
    /// Advance paper past the cutter, then cut.
    /// Thermal cutters sit ~15–40mm above the print head; feeding only a few
    /// lines (old default: 3) slices the last kitchen/receipt lines mid-ticket.
    /// Line spacing is ESC 3 24 → each Feed ≈ 24 dots (~3mm @ 203dpi).
    /// </summary>
    public EscPosDocument Cut(int feedLines = 10)
    {
        if (feedLines > 0) Feed(feedLines);
        // GS V 0 — full cut (widely supported on ESC/POS clones)
        Raw(0x1d, (byte)'V', 0x00);
        return this;
    }

    public byte[] ToBytes() => _ms.ToArray();

    private void Align(EscPosAlign align)
    {
        var n = align switch
        {
            EscPosAlign.Center => (byte)1,
            EscPosAlign.Right => (byte)2,
            _ => (byte)0,
        };
        Raw(0x1b, (byte)'a', n);
    }

    private void Raw(params byte[] bytes) => _ms.Write(bytes, 0, bytes.Length);

    private byte[] RenderArabicLine(string logicalText, EscPosAlign align, float fontSize, bool bold)
    {
        using var font = CreateFont(fontSize, bold ? FontStyle.Bold : FontStyle.Regular);
        var bmpW = _widthDots;
        // Height: allow wrapping for long lines
        var maxH = Math.Min(320, (int)(fontSize * 6) + 16);

        using var bmp = new Bitmap(bmpW, maxH, PixelFormat.Format32bppArgb);
        int usedHeight;
        using (var g = Graphics.FromImage(bmp))
        {
            PrepareGraphics(g);
            using var sf = RtlFormat(align);
            var rect = new RectangleF(2, 2, bmpW - 4, maxH - 4);
            using var brush = new SolidBrush(Color.Black);
            g.DrawString(logicalText, font, brush, rect, sf);
            var size = g.MeasureString(logicalText, font, new SizeF(bmpW - 4, maxH), sf);
            usedHeight = Math.Clamp((int)Math.Ceiling(size.Height) + 6, (int)fontSize + 8, maxH);
        }

        return CropToEscStar(bmp, usedHeight, maxH);
    }

    private byte[] RenderTwoColumnLine(string rightText, string leftText, float fontSize, bool bold)
    {
        using var font = CreateFont(fontSize, bold ? FontStyle.Bold : FontStyle.Regular);
        var bmpW = _widthDots;
        var maxH = Math.Min(160, (int)(fontSize * 4) + 20);
        using var bmp = new Bitmap(bmpW, maxH, PixelFormat.Format32bppArgb);
        int usedHeight;
        using (var g = Graphics.FromImage(bmp))
        {
            PrepareGraphics(g);
            using var brush = new SolidBrush(Color.Black);
            using var sfRight = RtlFormat(EscPosAlign.Right);
            using var sfLeft = RtlFormat(EscPosAlign.Left);
            var pad = 6f;
            var half = (bmpW / 2f) - pad;
            var rightRect = new RectangleF(bmpW / 2f, 2, half, maxH - 4);
            var leftRect = new RectangleF(pad, 2, half, maxH - 4);
            if (!string.IsNullOrWhiteSpace(rightText))
                g.DrawString(rightText, font, brush, rightRect, sfRight);
            if (!string.IsNullOrWhiteSpace(leftText))
                g.DrawString(leftText, font, brush, leftRect, sfLeft);
            var hR = string.IsNullOrWhiteSpace(rightText) ? 0 :
                g.MeasureString(rightText, font, new SizeF(half, maxH), sfRight).Height;
            var hL = string.IsNullOrWhiteSpace(leftText) ? 0 :
                g.MeasureString(leftText, font, new SizeF(half, maxH), sfLeft).Height;
            usedHeight = Math.Clamp((int)Math.Ceiling(Math.Max(hR, hL)) + 8, (int)fontSize + 10, maxH);
        }
        return CropToEscStar(bmp, usedHeight, maxH);
    }

    private byte[] RenderBox(IReadOnlyList<(string Text, float FontSize, bool Bold)> lines, int border)
    {
        var bmpW = _widthDots;
        var padX = 10;
        var padY = 10;
        var gap = 4;
        var contentW = bmpW - padX * 2 - border * 2;
        var heights = new int[lines.Count];
        var totalTextH = 0;
        using (var measureBmp = new Bitmap(8, 8))
        using (var g = Graphics.FromImage(measureBmp))
        {
            PrepareGraphics(g);
            for (var i = 0; i < lines.Count; i++)
            {
                var (text, size, bold) = lines[i];
                using var font = CreateFont(size, bold ? FontStyle.Bold : FontStyle.Regular);
                using var sf = RtlFormat(EscPosAlign.Center);
                var h = string.IsNullOrWhiteSpace(text)
                    ? (int)size
                    : (int)Math.Ceiling(g.MeasureString(text, font, new SizeF(contentW, 200), sf).Height);
                heights[i] = Math.Max(h, (int)size + 4);
                totalTextH += heights[i];
                if (i < lines.Count - 1) totalTextH += gap;
            }
        }

        var innerH = totalTextH + padY * 2;
        var maxH = Math.Min(480, ((innerH + border * 2 + 23) / 24) * 24 + 24);
        using var bmp = new Bitmap(bmpW, maxH, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            PrepareGraphics(g);
            g.Clear(Color.White);
            using var pen = new Pen(Color.Black, border);
            var box = new Rectangle(
                padX / 2,
                2,
                bmpW - padX,
                innerH + border);
            g.DrawRectangle(pen, box);

            var y = box.Y + border + padY;
            using var brush = new SolidBrush(Color.Black);
            for (var i = 0; i < lines.Count; i++)
            {
                var (text, size, bold) = lines[i];
                if (!string.IsNullOrWhiteSpace(text))
                {
                    using var font = CreateFont(size, bold ? FontStyle.Bold : FontStyle.Regular);
                    using var sf = RtlFormat(EscPosAlign.Center);
                    var rect = new RectangleF(box.X + border + 2, y, box.Width - border * 2 - 4, heights[i]);
                    g.DrawString(text, font, brush, rect, sf);
                }
                y += heights[i] + gap;
            }
        }

        var used = Math.Clamp(innerH + border * 2 + 8, 48, maxH);
        return CropToEscStar(bmp, used, maxH);
    }

    private static void PrepareGraphics(Graphics g)
    {
        g.Clear(Color.White);
        // Critical: AntiAlias enables Uniscribe Arabic joining (SingleBitPerPixel does NOT)
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
    }

    private static StringFormat RtlFormat(EscPosAlign align) =>
        new(StringFormat.GenericTypographic)
        {
            FormatFlags = StringFormatFlags.DirectionRightToLeft
                | StringFormatFlags.MeasureTrailingSpaces
                | StringFormatFlags.NoClip,
            Alignment = MapAlignment(align, rtl: true),
            LineAlignment = StringAlignment.Near,
            Trimming = StringTrimming.EllipsisCharacter,
        };

    private byte[] CropToEscStar(Bitmap bmp, int usedHeight, int maxH)
    {
        var cropH = Math.Min(Math.Max(usedHeight, 8), maxH);
        // Drop pure-white rows at top/bottom so Arabic metrics don't leave
        // multi-centimetre blank bands above the restaurant name.
        var (top, bottom) = FindInkBounds(bmp, cropH);
        if (bottom < top)
        {
            top = 0;
            bottom = Math.Max(0, cropH - 1);
        }
        var contentH = bottom - top + 1;
        var pad = 2;
        var y0 = Math.Max(0, top - pad);
        var y1 = Math.Min(bmp.Height - 1, bottom + pad);
        var rawH = y1 - y0 + 1;
        var bandH = ((rawH + 23) / 24) * 24;
        bandH = Math.Min(bandH, bmp.Height - y0);
        if (bandH < 24) bandH = 24;

        using var cropped = bmp.Clone(new Rectangle(0, y0, bmp.Width, bandH), PixelFormat.Format32bppArgb);
        return BitmapToEscStar(cropped);
    }

    /// <summary>First/last row that has dark ink (anti-aliased threshold).</summary>
    private static (int Top, int Bottom) FindInkBounds(Bitmap bmp, int searchH)
    {
        var h = Math.Min(searchH, bmp.Height);
        var w = bmp.Width;
        var rect = new Rectangle(0, 0, w, h);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var stride = data.Stride;
            var raw = new byte[Math.Abs(stride) * h];
            Marshal.Copy(data.Scan0, raw, 0, raw.Length);
            static bool Dark(byte[] buf, int stride, int x, int y)
            {
                var i = y * stride + x * 4;
                var lum = (buf[i + 2] + buf[i + 1] + buf[i]) / 3;
                return lum < 160;
            }

            var top = -1;
            for (var y = 0; y < h; y++)
            {
                for (var x = 0; x < w; x++)
                {
                    if (!Dark(raw, stride, x, y)) continue;
                    top = y;
                    break;
                }
                if (top >= 0) break;
            }

            var bottom = -1;
            for (var y = h - 1; y >= 0; y--)
            {
                for (var x = 0; x < w; x++)
                {
                    if (!Dark(raw, stride, x, y)) continue;
                    bottom = y;
                    break;
                }
                if (bottom >= 0) break;
            }

            return (top, bottom);
        }
        finally
        {
            bmp.UnlockBits(data);
        }
    }

    private static StringAlignment MapAlignment(EscPosAlign align, bool rtl) =>
        align switch
        {
            // In RTL: Near = right edge, Far = left edge
            EscPosAlign.Center => StringAlignment.Center,
            EscPosAlign.Right => rtl ? StringAlignment.Near : StringAlignment.Far,
            _ => rtl ? StringAlignment.Far : StringAlignment.Near,
        };

    private static Font CreateFont(float size, FontStyle style)
    {
        foreach (var name in new[] { "Segoe UI", "Tahoma", "IBM Plex Sans Arabic", "Arial" })
        {
            try { return new Font(name, size, style, GraphicsUnit.Pixel); }
            catch { /* next */ }
        }
        return new Font(FontFamily.GenericSansSerif, size, style, GraphicsUnit.Pixel);
    }

    /// <summary>
    /// ESC * m=33 (24-dot double-density) — widely supported on ESC/POS clones.
    /// </summary>
    private static byte[] BitmapToEscStar(Bitmap bmp)
    {
        var width = bmp.Width;
        var height = bmp.Height;
        var pixels = LockMono(bmp);

        using var ms = new MemoryStream();
        void W(params byte[] b) => ms.Write(b, 0, b.Length);

        for (var y = 0; y < height; y += 24)
        {
            var nL = (byte)(width & 0xff);
            var nH = (byte)((width >> 8) & 0xff);
            // ESC * 33 nL nH
            W(0x1b, 0x2a, 33, nL, nH);

            for (var x = 0; x < width; x++)
            {
                byte b0 = 0, b1 = 0, b2 = 0;
                for (var k = 0; k < 24; k++)
                {
                    var yy = y + k;
                    if (yy >= height) continue;
                    if (!pixels[yy * width + x]) continue;
                    if (k < 8) b0 |= (byte)(0x80 >> k);
                    else if (k < 16) b1 |= (byte)(0x80 >> (k - 8));
                    else b2 |= (byte)(0x80 >> (k - 16));
                }
                W(b0, b1, b2);
            }

            // Feed ~24 dots so the next band doesn't overlap
            W(0x1b, (byte)'J', 24);
        }

        return ms.ToArray();
    }

    /// <summary>true = black (print).</summary>
    private static bool[] LockMono(Bitmap bmp)
    {
        var width = bmp.Width;
        var height = bmp.Height;
        var result = new bool[width * height];
        var rect = new Rectangle(0, 0, width, height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var stride = data.Stride;
            var raw = new byte[Math.Abs(stride) * height];
            Marshal.Copy(data.Scan0, raw, 0, raw.Length);
            for (var y = 0; y < height; y++)
            {
                for (var x = 0; x < width; x++)
                {
                    var i = y * stride + x * 4;
                    var lum = (raw[i + 2] + raw[i + 1] + raw[i]) / 3;
                    // Anti-aliased edges → threshold
                    result[y * width + x] = lum < 160;
                }
            }
        }
        finally
        {
            bmp.UnlockBits(data);
        }
        return result;
    }
}
