# Smart Windows printer rematch

**Status:** ✅ **Production** (2026-07-15) · Bridge **0.4.0+** required  
**Problem:** Windows queue names change across PCs / reinstalls (`XP-80`, `XP-80 (copy 1)`, `XP-80C (copy 3)`). Binding by name alone fails.

## Behaviour

1. Bridge inventory (every poll after heartbeat) sends: Windows name, default flag, **driver**, **port**, **DeviceID**.
2. Server never keeps a stale `windows_printer_name` that is absent from the online Bridge inventory.
3. Match order:
   - **Sole thermal** on the PC → use it (cashier-friendly new PC).
   - Exact name still present.
   - Score: normalized name / base model (`XP-80C`→`XP-80`) + previous driver + port + DeviceID.
4. Diagnostics explains remaps in Arabic («وجدنا طابعة مختلفة… بدلاً من…») with **تطبيق الآن** (= `sync_print_station_bindings`).
5. Bridge also resolves locally at print time if the spooler name is missing.

## Artifacts

- Migration: `supabase/migrations/20260715200000_smart_printer_rematch.sql`
- Bridge: `apps/print-bridge/WindowsPrinterInventory.cs` · version `0.4.0`
- UI: Print Center → تشخيص

## Production

✅ Promoted 2026-07-15: migration `20260715200000_smart_printer_rematch.sql` · deploy https://niha-yam.vercel.app · Bridge download **0.4.0**.

Install/update Bridge from Print Center → تنزيل Bridge on each cashier PC, then pair (or resume). Auto-remap runs on inventory/heartbeat.

### Portable ownership (2026-07-19 · Bridge 0.5.8+)

Moving one thermal between PCs: **Pair on the new PC**. `pair_print_bridge` + `m6_transfer_restaurant_print_ownership` deactivate other Bridges for the restaurant and reroute printers/open jobs. Sole-printer auto-bind can also take ownership when inventory sees the thermal even if the previous Bridge is still online. Test: `pnpm test:portable-printer`.

## Plain-Arabic diagnostics (2026-07-16)

✅ **Production** — migration `20260716120000_print_diag_plain_arabic.sql` · UI https://niha-yam.vercel.app · [details](./print-diagnostics-plain-arabic.md)  
Smoke: Testing 17/17 · Production diagnose Arabic PASS.
