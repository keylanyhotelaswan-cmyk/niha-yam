# NIHA POS

Modern cloud restaurant POS and management system.

**Version:** 0.1.0  
**Status:** M1 Auth & Staff (implementation)

## Stack

- React + Vite + TypeScript
- Tailwind CSS + shadcn-style UI primitives
- TanStack Query
- Supabase Cloud (PostgreSQL, Auth, RLS — domain schema from M1+)
- Deploy: Vercel (frontend)

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 9+ (`corepack enable` or `npm i -g pnpm`)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for migrations against Cloud)
- A **Supabase Cloud** project ([dashboard](https://supabase.com/dashboard))

## Local development

### 1. Install dependencies

**macOS / Linux (bash):**

```bash
pnpm install
cp .env.example .env.local
```

**Windows (PowerShell):**

```powershell
pnpm install
Copy-Item .env.example .env.local
```

### 2. Configure Supabase Cloud

In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings** → **API**:

1. Copy **Project URL** → `VITE_SUPABASE_URL`
2. Copy **anon public** key → `VITE_SUPABASE_ANON_KEY`

Edit `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY` is required only for the one-time owner bootstrap script (never exposed to the frontend).

Verify the connection:

**macOS / Linux:**

```bash
pnpm verify:supabase
```

**Windows (PowerShell):**

```powershell
pnpm verify:supabase
```

### 3. Start the app

```bash
pnpm dev
```

Open [http://127.0.0.1:5173/health](http://127.0.0.1:5173/health) — status should show **Connected to Supabase Cloud successfully.**

### 4. Link Supabase CLI (for future migrations)

One-time setup per machine:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

`YOUR_PROJECT_REF` is the subdomain from your project URL (e.g. `https://abcd1234.supabase.co` → `abcd1234`).

Push migrations to Cloud (M1+):

```bash
supabase db push
```

### 5. First-time project setup

After migrations are applied:

1. **Seed** creates one restaurant and one branch only (no staff, no auth users).
2. **Bootstrap the first Owner** with the documented script (username-based login, ADR-0018):

**macOS / Linux:**

```bash
pnpm bootstrap:owner -- --username owner --password 'YourSecurePassword' --name "Owner Name"
```

**Windows (PowerShell):**

```powershell
pnpm bootstrap:owner -- --username owner --password "YourSecurePassword" --name "Owner Name"
```

The script uses `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` to create the Auth user
(internal email `<username>@staff.niha.local`) and call `bootstrap_owner_staff`, linking
the user as **owner** on the seeded branch. Add `--reset` to discard any existing staff and
re-bootstrap on the username model (M2 / ADR-0018 Q-C).

3. Sign in at `/login` with the owner **username + password**, then manage staff at `/admin/staff`.

### 6. Edge Functions (M2 — privileged staff ops)

Staff creation and password resets run in Supabase Edge Functions so the service role never
reaches the browser (ADR-0019). Deploy them once:

```bash
supabase functions deploy staff-create
supabase functions deploy staff-reset-password
```

Serve locally for development with `supabase functions serve`. The functions read
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the function
environment (auto-provided on Supabase; set as function secrets when needed).

Regenerate TypeScript types after schema changes:

```bash
supabase gen types typescript --project-id YOUR_PROJECT_REF > src/types/database.generated.ts
```

## Scripts

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `pnpm dev`             | Start Vite dev server            |
| `pnpm build`           | Production build                 |
| `pnpm preview`         | Preview production build         |
| `pnpm lint`            | ESLint                           |
| `pnpm typecheck`       | TypeScript check                 |
| `pnpm format`          | Prettier write                   |
| `pnpm format:check`    | Prettier check (CI)              |
| `pnpm verify:supabase` | Test Supabase Cloud connectivity |
| `pnpm bootstrap:owner` | One-time first Owner setup       |

## Project structure

```
src/
  app/          # Shell: routes, layouts, providers
  features/     # Domain modules (M1+)
  shared/       # UI primitives, utils
  lib/          # Supabase, query, logger
supabase/
  migrations/   # SQL migrations (applied to Cloud via CLI)
```

## Module delivery

Work proceeds module by module: Plan → Review → Approval → Implementation → Testing → Sign-off.

Current module: **M3 Menu & Products** — categories, items, modifiers, tax rates (M2 Staff approved 2026-07-08).

## Deployment (Vercel)

**Official production project:** `niha-yam` → https://niha-yam.vercel.app  
**Repo:** `keylanyhotelaswan-cmyk/niha-yam` · branch `main`  
**Baseline:** [docs/release-operational-v1.1.md](./docs/release-operational-v1.1.md) (`v1.1.0-production`)

Set **only** these environment variables (Production / Preview / Development):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Do not** set `SUPABASE_SERVICE_ROLE_KEY` or legacy `VITE_API_URL` on Vercel.

Build is defined in `vercel.json` (`pnpm install --frozen-lockfile` · `pnpm build` · `dist`). SPA rewrites exclude `/downloads/*` so Print Bridge zip/manifest stay static.

> Legacy project `niha` (niha-omega.vercel.app) is **archive only** — not the production host.

## CI

GitHub Actions runs on every push/PR: `lint` → `format:check` → `typecheck` → `build`.
