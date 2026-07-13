# NIHA ERP — Operational Baseline Release

**Release name:** NIHA ERP Operational v1.1  
**Tag:** `v1.1.0-production`  
**Date:** 2026-07-13  
**Status:** Official **Baseline** after production deploy succeeds

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

### Vercel — frontend only

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `VITE_SUPABASE_URL` | ✅ | Supabase Cloud project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Public anon key only |

**Must never be set on Vercel:**

| Variable | Why |
| -------- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Local scripts / Edge secrets only — never `VITE_` |
| `VITE_API_URL` | Legacy Render API — **removed** (not used by this Vite app) |

SPA routing: `vercel.json` rewrites non-`/downloads/*` routes to `index.html`.  
Build: `pnpm build` (`tsc -b && vite build`). Node: Vercel project **24.x** (CI uses 22 — both OK).

### Supabase

- Cloud project (not local Docker) is the production backend.
- Edge Functions use platform secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — not Vercel.

### Print Center / Bridge

| Check | Expected |
| ----- | -------- |
| `public/downloads/bridge-manifest.json` → `version` | **0.3.13** |
| Download zip | `/downloads/niha-print-bridge-win-x64.zip` |
| Assembly | `Niha.PrintBridge` **0.3.13** |

---

## Pre-deploy checklist (executed 2026-07-13)

- [x] `pnpm typecheck` green  
- [x] `pnpm build` green  
- [x] Bundle uses only `VITE_SUPABASE_*` (no service role)  
- [x] Local `.env.local` = Cloud URL (not localhost)  
- [x] Vercel env cleaned: removed `VITE_API_URL`; added `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Production / Preview / Development)  
- [x] Bridge manifest **0.3.13** + zip staged under `public/downloads/`  
- [x] Production URL serves manifest `0.3.13` and zip (binary, not SPA HTML)  
- [ ] Smoke: login · POS · Print Center download label shows v0.3.13  

**Production URL:** https://niha-omega.vercel.app  
**Deployment:** `niha-ldcc2ppjj-niha3.vercel.app` (2026-07-13)
---

## After deploy = Baseline

When production smoke passes:

1. This tag is the **official ops Baseline**.  
2. Ops / POS / Printing / Reports / Recipes / Inventory INVA / Shift Handover remain frozen.  
3. Next capability work is **Suppliers & Purchasing** — Plan → Review → Approve only (no Implement until Approve).

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| **1.0** | **2026-07-13** | Operational v1.1 Baseline definition + Vercel env correction |
