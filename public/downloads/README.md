# Print Bridge downloads (Print Center)

Official distribution folder for **NIHA Print Bridge**.

## Generate the package

From the repo root (requires .NET 8 SDK + `.env.local` with Supabase URL/anon key; Inno Setup 6 optional for Setup.exe):

```bash
pnpm bridge:publish
```

This writes:

| File | Purpose |
|------|---------|
| `NihaPrintBridge-Setup.exe` | Recommended installer → `%LocalAppData%\Programs\NIHA Print Bridge` |
| `niha-print-bridge-win-x64.zip` | Auto-update package + IT zip |
| `bridge-manifest.json` | Version, What’s New `notes`, `setupUrl`, zip `url` |

Managers download from: **الإدارة → مركز الطباعة → تنزيل المثبّت (Setup)**

Pairing without camera: Print Center → **نسخ رمز الربط الكامل** → Bridge → **لصق الرمز**.
