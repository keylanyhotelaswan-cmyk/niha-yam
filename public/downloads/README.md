# Print Bridge downloads (Print Center)

Official distribution folder for **NIHA Print Bridge**.

## Generate the package

From the repo root (requires .NET 8 SDK + `.env.local` with Supabase URL/anon key):

```bash
pnpm bridge:publish
```

This writes:

- `niha-print-bridge-win-x64.zip` — self-contained Windows app + `bridge-defaults.json`
- `bridge-manifest.json` — version metadata for the Print Center download button

Managers download from: **الإدارة → مركز الطباعة → تنزيل NIHA Print Bridge**
