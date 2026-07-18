# NIHA Print Bridge (M6B)

Standalone **.NET 8 Windows tray** app — [ADR-0030](../../docs/adr/0030-niha-print-bridge.md).

## Official download (restaurants)

Managers download from **Print Center** only (BP-14):

**الإدارة → مركز الطباعة → تنزيل المثبّت (Setup)**

```bash
pnpm bridge:publish
```

Produces under `public/downloads/`:

| Artifact | Purpose |
|----------|---------|
| `NihaPrintBridge-Setup.exe` | Inno Setup → `%LocalAppData%\Programs\NIHA Print Bridge` + Desktop/Start Menu |
| `niha-print-bridge-win-x64.zip` | Auto-update package + IT zip fallback |
| `bridge-manifest.json` | Version, `notes` (What’s New), `setupUrl`, zip `url` |

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`ISCC.exe`) on the build machine for Setup.exe. Zip always publishes.

## Install vs data

| Path | Contents |
|------|----------|
| `%LocalAppData%\Programs\NIHA Print Bridge` | Binaries (updated in place) |
| `%LocalAppData%\NihaPrintBridge` | `config.json` Connections, logs, offline DB — **never wiped by update** |

## Pairing (no camera)

1. Print Center → create pair code → **نسخ رمز الربط الكامل** (or QR).
2. Bridge → **لصق الرمز** (primary) or Scan QR from clipboard image.
3. Short code alone is only for the **first** environment; dual-env needs full token/QR.

## Auto-update

Tray / Settings → **التحقق من التحديث**. Shows What’s New, download %, install, restart. Auto-check every 6h shows a balloon + the same form (never silent mid-shift apply).

## Arabic output (v0.2.3+)

Arabic lines are drawn with **GDI+ Uniscribe** (joined RTL), then sent as
**ESC \*** bit-image bands (widely supported).

## Principles

- Not part of the POS web app; not Electron; not browser-dependent.
- **Never** embeds `SUPABASE_SERVICE_ROLE_KEY` — anon key + pair token only.
- Pipeline: **Claim → Render → Print → Report**
- Offline SQLite buffer; **TTL** enforced (no auto-print of expired jobs).
- Report `delivery=transport_ack` by default (send ≠ paper-out).

## Field test checklist

1. Install via Setup.exe on a fresh PC  
2. Pair with Pairing Token (no camera) → success  
3. Bridge online in Print Center → Health  
4. POS order → jobs → paper  
5. Check for update → What’s New → Update Now → restart keeps pairing  
6. Dual-env: paste Testing Pairing Token → both envs stay  

## Autostart

Tray → **التشغيل مع Windows**.

## Manage connections (cashier PCs)

Main window or tray → **إدارة الاتصالات**:
- Per-env: reconnect / delete / set default
- **إعادة ضبط الاتصالات** — clears `Connections[]` only (keeps autostart, update prefs, install path)
- Per-env diagnostics: Last Poll · Claim count · Print result · Reason · pipeline

## About / support diagnostics

Main window or tray → **حول البرنامج**:
- version, install path, data path, last heartbeat
- **نسخ معلومات التشخيص** — plain text for WhatsApp/email support (no screenshots)

## Logs (advanced)

`%LocalAppData%\NihaPrintBridge\bridge.log`
