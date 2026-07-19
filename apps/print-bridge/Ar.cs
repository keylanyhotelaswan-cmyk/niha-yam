namespace Niha.PrintBridge;

/// <summary>Arabic UI copy for restaurant operators (not developers).</summary>
public static class Ar
{
    public const string AppTitle = "NIHA Print Bridge";
    public const string AppSubtitle = "جسر الطباعة";

    public const string Pair = "اقتران";
    public const string Cancel = "إلغاء";
    public const string Close = "إغلاق";
    public const string Save = "حفظ";
    public const string PairCode = "رمز الاقتران";
    public const string PairHint =
        "الصق رمز الربط الكامل أو امسح QR — الرمز القصير يكفي لبيئة واحدة فقط (الإنتاج عادة).\n" +
        "إضافة بيئة اختبار لا تمسح الإنتاج: تُضاف بجانب الاتصال الحالي.";
    public const string PairSuccess = "تم الاقتران بنجاح";
    public const string PairFailed = "فشل الاقتران";
    public const string Pairing = "جاري الاقتران…";
    public const string PairReadyEnvFmt = "جاهز للربط: {0}";
    public const string PairAddingSecondEnv =
        "سيتم إضافة بيئة ثانية (اختبار عادة) بجانب الإنتاج — لن يُمسح الربط الحالي.";
    public const string ScanQr = "مسح QR";
    public const string ScanQrHint =
        "بدون كاميرا: انسخ «رمز الربط الكامل» من مركز الطباعة ثم الصق الرمز.\n" +
        "أو انسخ صورة QR إلى الحافظة (Win+Shift+S) ثم اضغط مسح QR.";
    public const string PasteCode = "لصق الرمز";
    public const string EnterCode = "رمز الربط الكامل أو الرمز القصير";
    public const string MissingCloudConfig =
        "ملف الإعدادات غير موجود. أعد تنزيل البرنامج من مركز الطباعة داخل الإدارة.";
    public const string MissingCloudConfigHint =
        "الصق رمز الربط الكامل من مركز الطباعة (يحتوي على بيانات الاتصال).";
    public const string InvalidCode = "رمز الاقتران غير صالح";
    public const string NeedQrForSecondEnv =
        "لا يمكن استخدام الرمز المختصر عند ربط بيئة إضافية.\n\n" +
        "الصق «رمز الربط الكامل» أو امسح رمز QR من مركز طباعة الاختبار.\n" +
        "هذا يُضيف بيئة ثانية فقط — الإنتاج يبقى مربوطًا. لا تحذف اتصال الإنتاج.";
    public const string AlreadyRunning =
        "برنامج NIHA Print Bridge يعمل بالفعل على هذا الجهاز.\n" +
        "أغلق النسخة الأخرى من شريط المهام ثم أعد المحاولة.";

    public const string Connecting = "جاري الاتصال";
    public const string Connected = "متصل";
    public const string Disconnected = "غير متصل";
    public const string NotPaired = "غير مقترن";
    public const string Paired = "مقترن";

    public const string Activity = "نشاط الطباعة";
    public const string ActivityIdle = "—";
    public const string ActivityWaiting = "في انتظار المهام";
    public const string ActivityClaiming = "جاري المطالبة بالمهام…";
    public const string ActivityProcessing = "جاري معالجة مهمة…";
    public const string ActivityRendering = "جاري تجهيز الإيصال…";
    public const string ActivityPrinting = "جاري الإرسال للطابعة…";
    public const string ActivityReporting = "جاري تحديث حالة المهمة…";
    public const string LastStage = "آخر مرحلة";

    public const string DeviceName = "اسم الجهاز";
    public const string Restaurant = "الاتصالات";
    public const string RestaurantName = "المطعم";
    public const string ConnectionsTitle = "الاتصالات";
    public const string EnvProduction = "إنتاج";
    public const string EnvTesting = "اختبار";
    public const string EnvUnknown = "بيئة";
    public const string ConnOnline = "متصل";
    public const string ConnOffline = "غير متصل";

    public const string ManageConnections = "إدارة الاتصالات";
    public const string ManageConnectionsHint =
        "الاتصال ≠ الطباعة. لكل بيئة: Poll · Claim · مطبوع · آخر خطأ · مسار الدورة.\n" +
        "لاختبار بيئة الاختبار: «إضافة بيئة» برمز الربط الكامل — لا تمسح الإنتاج.\n" +
        "«إعادة الاقتران» يعيد ربط بيئة واحدة دون حذف الأخرى.";
    public const string NoConnections =
        "لا توجد اتصالات محفوظة. اضغط «إضافة بيئة» أو الصق رمز الربط الكامل.";
    public const string AddEnvironment = "إضافة بيئة اختبار / جديدة";
    public const string AddEnvironmentHint =
        "يُضاف اتصال ثانٍ (مثل الاختبار) بجانب الإنتاج. الإنتاج لا يُمس.";
    public const string RePairConnection = "إعادة الاقتران";
    public const string RePairHintFmt =
        "إعادة اقتران «{0}» فقط — بقية البيئات لن تُمس.\n" +
        "الصق رمز الربط الكامل أو الرمز القصير من مركز الطباعة لهذه البيئة.";
    public const string RePairConfirmFmt =
        "إعادة اقتران «{0}»؟\n\n" +
        "سيُحذف رمز الربط لهذه البيئة فقط، ثم يُفتح معالج الاقتران.\n" +
        "الطابعات وإعدادات البرنامج واتصالات البيئات الأخرى تبقى.";
    public const string DeleteConnection = "حذف الاتصال";
    public const string SetDefault = "تعيين كافتراضي";
    public const string DefaultBadge = "افتراضي";
    public const string DeleteConnectionConfirmFmt =
        "حذف اتصال «{0}» من هذا الجهاز؟ ستحتاج إلى الربط مرة أخرى لهذه البيئة.";
    public const string ResetConnections = "إعادة ضبط الاتصالات";
    public const string ResetConnectionsConfirm =
        "سيتم حذف جميع الاتصالات المحفوظة فقط.\n\n" +
        "لن يتم حذف:\n" +
        "• الطابعات\n" +
        "• إعدادات البرنامج\n" +
        "• ملفات البرنامج\n\n" +
        "وستحتاج إلى ربط البيئات مرة أخرى.\n\nمتابعة؟";
    public const string ResetConnectionsDone = "تم حذف الاتصالات. اربط البيئات من جديد.";
    public const string ConnLastPoll = "آخر Poll";
    public const string ConnClaimFmt = "Claim: {0}";
    public const string ConnClaimZero = "Claim: 0";
    public const string ConnReceivedTotal = "مستلمة";
    public const string ConnPrintedTotal = "مطبوعة";
    public const string ConnPrint = "Print";
    public const string ConnLastError = "آخر خطأ";
    public const string ConnPipeline = "المسار";
    public const string CopyErrorDetails = "نسخ تفاصيل الخطأ";
    public const string ErrorDetailsCopied = "تم نسخ تفاصيل الخطأ";
    public const string PairCodeExpired = "انتهت صلاحية رمز الاقتران — أنشئ رمزاً جديداً من مركز الطباعة";
    public const string Printers = "الطابعات";
    public const string NoPrinters = "لا توجد طابعات مثبتة على هذا الجهاز";
    public const string TestPrint = "اختبار محلي (تشخيص)";
    public const string Testing = "جاري الطباعة…";
    public const string PrintOk = "تمت الطباعة";
    public const string PrintFail = "فشل الطباعة";
    public const string AdminHint =
        "إدارة الطابعات واختبار الطباعة من مركز الطباعة في الإدارة — هذا البرنامج منفّذ فقط.";
    public const string PrintersDiscovered = "طابعات ويندوز المكتشفة (تُرسل للإدارة تلقائيًا)";
    public const string Retry = "إعادة المحاولة";
    public const string LastPrint = "آخر عملية طباعة";
    public const string None = "—";

    public const string RePair = "ربط بيئة (إنتاج أو اختبار)";
    public const string OpenPrintCenter = "فتح مركز الطباعة";
    public const string ShowWindow = "فتح النافذة";
    public const string Exit = "خروج";
    public const string StartWithWindows = "التشغيل تلقائيًا مع Windows";
    public const string AutoUpdate = "تحديث تلقائي للبرنامج";
    public const string CheckUpdate = "التحقق من التحديث";
    public const string UpdateNow = "تحديث الآن";
    public const string UpdateAvailableFmt = "يتوفر تحديث: {0} ← {1}";
    public const string UpdateUpToDateFmt = "أحدث إصدار مثبت ({0})";
    public const string UpdateCheckFail = "تعذّر التحقق من التحديث";
    public const string UpdateNoUrl = "رابط مركز الطباعة غير متوفر";
    public const string UpdateBadPackage = "حزمة التحديث غير صالحة";
    public const string UpdateApplying = "جاري التحديث وإعادة التشغيل…";
    public const string UpdateFail = "فشل التحديث";
    public const string UpdateConfirm =
        "سيتم تنزيل الإصدار الجديد وإعادة تشغيل البرنامج. المتابعة؟";
    public const string UpdateLater = "لاحقاً";
    public const string UpdateWhatsNew = "ما الجديد";
    public const string UpdateDownloading = "جاري التنزيل… {0}%";
    public const string UpdateVerifying = "جاري التحقق من الحزمة…";
    public const string UpdateInstalling = "جاري التثبيت…";
    public const string UpdateRestarting = "جاري إعادة التشغيل…";
    public const string UpdateTitle = "تحديث NIHA Print Bridge";
    public const string Settings = "إعدادات الجهاز";

    public const string About = "حول البرنامج";
    public const string AboutTitle = "حول NIHA Print Bridge";
    public const string CopyDiagnostics = "نسخ معلومات التشخيص";
    public const string DiagnosticsCopied = "تم النسخ — أرسل النص للدعم الفني";

    public const string Advanced = "التشخيص المتقدم";
    public const string HideAdvanced = "إخفاء التشخيص";
    public const string Version = "الإصدار";
    public const string BridgeId = "معرّف الجسر";
    public const string Heartbeat = "آخر وقت اتصال";
    public const string LastClaim = "آخر مطالبة";
    public const string InstallPath = "مسار التثبيت";
    public const string DataPath = "مسار حفظ البيانات";
    public const string OpenLogs = "فتح مجلد السجلات";
    public const string TechNote = "للدعم الفني فقط — لا يحتاجها مدير المطعم.";

    public const string Status = "الحالة";
    public const string SelectPrinter = "اختر طابعة للاختبار";
    public const string ShowVirtualPrinters = "إظهار الطابعات الافتراضية (PDF / OneNote / XPS)";
    public const string VirtualTag = "افتراضية";
    public const string TrayNotPaired = "NIHA — غير مقترن";
    public const string TrayPaired = "NIHA Print Bridge";
}
