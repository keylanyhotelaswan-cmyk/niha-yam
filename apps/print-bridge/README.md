# NIHA Print Bridge (M6B)

Standalone **.NET 8 Windows tray** app — [ADR-0030](../../docs/adr/0030-niha-print-bridge.md).

## Official download (restaurants)

Managers download from **Print Center** only (BP-14):

**الإدارة → مركز الطباعة → تنزيل NIHA Print Bridge**

```bash
pnpm bridge:publish
```

## Arabic output (v0.2.3+)

Arabic lines are drawn with **GDI+ Uniscribe** (joined RTL), then sent as
**ESC \*** bit-image bands (widely supported). Older `GS v 0` was ignored by
some printers, which then printed raw bytes as broken disconnected Arabic.

## Principles

- Not part of the POS web app; not Electron; not browser-dependent.
- **Never** embeds `SUPABASE_SERVICE_ROLE_KEY` — anon key + pair token only.
- Pipeline: **Claim → Render → Print → Report**
- Offline SQLite buffer; **TTL** enforced (no auto-print of expired jobs).
- Report `delivery=transport_ack` by default (send ≠ paper-out).

## Field test checklist (before closing M6)

1. Download Bridge from Print Center on a fresh PC  
2. Run exe → Arabic pair screen (code only)  
3. Pair → success → main window  
4. Bridge online in Print Center → Health  
5. Select printer → Test Print → paper  
6. POS order → jobs → paper  
7. Queue: Retry / Print Again / Cancel  
8. Net down **&lt; TTL** → resume  
9. Net down **&gt; TTL** → expired → Print Again  

## Autostart

Tray → **التشغيل مع Windows**.

## Logs (advanced)

`%LocalAppData%\NihaPrintBridge\bridge.log`
