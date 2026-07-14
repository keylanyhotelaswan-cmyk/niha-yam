# NIHA ERP — Operational Baseline Release

**Release name:** NIHA ERP Operational v1.1  
**Tag:** `v1.1.0-production`  
**Date:** 2026-07-13  
**Status:** Official **Baseline** · Production project locked

---

## Official production (from this release)

| Item | Value |
| ---- | ----- |
| **Vercel project** | `niha-yam` (team `niha3`) |
| **Repository** | [keylanyhotelaswan-cmyk/niha-yam](https://github.com/keylanyhotelaswan-cmyk/niha-yam) |
| **Production branch** | `main` |
| **Production URL** | https://niha-yam.vercel.app |
| **Deployment (v1.1 cutover)** | `niha-nhqtu8nlf-niha3.vercel.app` (2026-07-13) |

### Archive (do not use for production)

| Item | Value |
| ---- | ----- |
| Old Vercel project | `niha` → https://niha-omega.vercel.app |
| Status | **Archive only** — not modified; not the official production host |

---

## What this release is

Frozen operational production baseline for Niha Yam:

| Layer | Version / note |
| ----- | -------------- |
| App (`APP_VERSION` / `package.json`) | **1.1.0** |
| Print Bridge (Print Center published) | **0.3.13** |
| Ops area | **Operational Freeze (final)** — bug / perf / simple UX only |
| Phase 1 freezes | POS · Printing · Reports |
| Phase 2 freezes | Recipes (RCA) · Inventory (INVA) · Shift Handover (OES) |

Includes: M0–M6 + M8 · Recipes · Inventory INVA · Shift Handover · Operational Completion / Hardening / Chaos · Operational Polish v1.2 (Feedback Center + Arabic cashier UX).

---

## Production configuration (locked for this Baseline)

### Vercel project `niha-yam`

| Setting | Value |
| ------- | ----- |
| Root Directory | `.` |
| Framework | Vite (via `vercel.json`) |
| Install | `pnpm install --frozen-lockfile` |
| Build | `pnpm build` |
| Output | `dist` |
| Node | 24.x |
| SPA | `vercel.json` rewrites (excludes `/downloads/*`) |

### Environment variables (frontend only)

| Variable | Environments |
| -------- | ------------ |
| `VITE_SUPABASE_URL` | Production · Preview · Development |
| `VITE_SUPABASE_ANON_KEY` | Production · Preview · Development |

**Must never be set on Vercel:**

| Variable | Why |
| -------- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Local scripts / Edge secrets only — never `VITE_` |
| `VITE_API_URL` | Legacy — not used by this app |

### Supabase

- Cloud project is the production backend.
- Edge Function secrets stay on Supabase — not on Vercel.

### Print Center / Bridge

| Check | Expected |
| ----- | -------- |
| `bridge-manifest.json` → `version` | **0.3.13** |
| Download zip | `/downloads/niha-print-bridge-win-x64.zip` (binary) |

---

## Cutover checklist (2026-07-13)

- [x] New Vercel project `niha-yam` created (old `niha` untouched)  
- [x] Git connected to `keylanyhotelaswan-cmyk/niha-yam` · branch `main`  
- [x] Env: only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`  
- [x] Production deploy Ready · aliased to https://niha-yam.vercel.app  
- [x] Home / login shell **200**  
- [x] Bridge manifest **0.3.13** + zip **66.9 MB** (`application/zip`)  
- [ ] Manual smoke: Login · POS · Reports · Print Center · Bridge download (in browser)

---

## After deploy = Baseline

1. **https://niha-yam.vercel.app** is the official production host for Operational v1.1.  
2. Ops / POS / Printing / Reports / Recipes / Inventory INVA / Shift Handover remain frozen.  
3. Next capability: **Suppliers & Purchasing** (Plan-gated).

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| 1.0 | 2026-07-13 | Baseline definition + first Vercel env correction |
| **1.1** | **2026-07-13** | Official production cutover to Vercel project `niha-yam` · old `niha` archived |
