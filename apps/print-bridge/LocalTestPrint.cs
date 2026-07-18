namespace Niha.PrintBridge;

/// <summary>Comprehensive Arabic shaping / alignment test page for ESC/POS.</summary>
public static class LocalTestPrint
{
    public static void Run(string printerName)
    {
        var cfg = ConfigStore.Load();
        var restaurant = string.IsNullOrWhiteSpace(cfg.RestaurantName)
            ? "مطعم نيها يام"
            : cfg.RestaurantName!;

        var doc = new EscPosDocument(widthDots: 576);

        doc.Line("NIHA", EscPosAlign.Center, fontSize: 28f, bold: true);
        doc.Line("Print Bridge", EscPosAlign.Center, fontSize: 18f, bold: true);
        doc.Line("جسر الطباعة", EscPosAlign.Center, fontSize: 20f, bold: true);
        doc.Separator();

        doc.Line(restaurant, EscPosAlign.Center, fontSize: 22f, bold: true);
        doc.Line($"الوقت: {DateTime.Now:yyyy-MM-dd HH:mm:ss}", EscPosAlign.Center, fontSize: 16f);
        doc.Separator();

        doc.Line("محاذاة يمين ←", EscPosAlign.Right, fontSize: 18f);
        doc.Line("→ محاذاة يسار", EscPosAlign.Left, fontSize: 18f);
        doc.Line("محاذاة وسط", EscPosAlign.Center, fontSize: 18f);
        doc.Separator();

        doc.Line("منتجات:", EscPosAlign.Right, fontSize: 18f, bold: true);
        doc.Line("برجر لحم مشوي × 2", EscPosAlign.Right, fontSize: 18f);
        doc.Line("Chicken Burger × 1", EscPosAlign.Left, fontSize: 18f);
        doc.Line("عصير برتقال طازج × 1", EscPosAlign.Right, fontSize: 18f);
        doc.Separator();

        doc.Line(
            "نص عربي طويل: نرحب بكم في نظام نيها لنقاط البيع، ونتمنى لكم تجربة طباعة واضحة وسلسة في المطبخ والصالة.",
            EscPosAlign.Right,
            fontSize: 16f);

        doc.Line(
            "نص مختلط: طلب #123 جاهز — Burger + بطاطس + 2× Pepsi",
            EscPosAlign.Right,
            fontSize: 16f);

        doc.Line($"Mixed: Hello NIHA — مرحبا — 456", EscPosAlign.Left, fontSize: 16f);
        doc.Separator();

        doc.Line("إذا ظهرت الحروف العربية متصلة وواضحة فالتشكيل يعمل.", EscPosAlign.Center, fontSize: 16f);
        doc.Line("If Arabic letters are joined, shaping works.", EscPosAlign.Center, fontSize: 14f);

        doc.Cut();
        var bytes = doc.ToBytes();
        var r = SpoolerTransport.PrintRaw(printerName, bytes, 1, "NIHA Local Test");
        if (!r.Ok)
            throw new InvalidOperationException($"{r.Stage}: {r.Detail}");
    }
}
