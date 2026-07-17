# Dual-environment printing (same Bridge + same printer)

## Goal

Use one cashier PC, one physical printer, and one NIHA Print Bridge install for both **Production** and **Testing**, without reinstalling or retargeting the Bridge every time.

## Design

1. **Bridge multi-connection (v0.5.0+)**  
   Local `config.json` holds a `Connections[]` list. Pairing from Testing QR **adds/updates** the Testing connection and **does not wipe** Production.

2. **Server-side Testing gate**  
   Table `print_ops_settings`:
   - `is_test_environment` — set via `m6_bootstrap_test_print_environment()` (Testing app only)
   - `testing_print_enabled` — manager toggle in Print Center → Diagnostics (Testing UI only)

   When Testing env is marked and the toggle is **OFF**, `claim_print_jobs` returns `[]`. Heartbeat and printer inventory still work. Production is never gated (`is_test_environment = false`).

3. **Test receipt banner**  
   Jobs on a test restaurant get `payload.test_env = true` (trigger + stamp helper). Bridge prints a clear Arabic banner at the top of every test ticket.

## Operator flow

1. Keep Production Bridge paired as usual.
2. Open Testing Print Center → Diagnostics → bootstrap runs automatically (`testing_print_enabled` stays **OFF** by default).
3. Once: **ربط بيئة** and scan the Testing pair QR (adds second connection).
4. **تفعيل الطباعة للاختبار** only while testing (confirm dialog + red armed banner across Print Center).
5. **إيقاف فوري** as soon as the test ends — Production keeps printing normally.

During live service hours leave the toggle **OFF**. The claim gate blocks Testing jobs; the armed banner exists so an ON state is hard to miss.

## Tests

```bash
pnpm migrate:testing
pnpm test:print-dual-env
```

Bridge package: bump to **0.5.0**, then `pnpm bridge:publish` when ready to ship the downloadable zip.

## Baseline Release — Bridge 0.5.0

**Bridge 0.5.0 is the reference baseline for dual-environment printing.**

- Multi-connection (`Connections[]`) behavior is frozen as the supported model: pairing Testing **adds/updates** a connection and must **not** wipe Production.
- Later print work should start from 0.5.0.
- Do **not** change dual-connection behavior unless there is a strong operational reason and an explicit review.

## Production promote checklist

1. Commit this release (Bridge + Frontend + migrations + docs) — independent of Production Safety / ADR-0035.
2. `pnpm migrate:production` (dual-env migrations only when earlier ones are already applied).
3. Deploy frontend (Vercel Production).
4. `pnpm bridge:publish` → Bridge **0.5.0** in `/downloads`.
5. Update cashier PCs to Bridge 0.5.0.
6. Read-only Production smoke / diagnose.
7. On **one** device first: pair Testing QR → verify Production still prints → Testing jobs stay blocked while toggle OFF → enable → test banner prints → immediate OFF → Testing stops, Production continues.
8. Roll out to remaining devices after that pilot succeeds.

**Never** run `m6_bootstrap_test_print_environment` against Production.
