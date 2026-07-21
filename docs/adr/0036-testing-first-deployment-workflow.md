# ADR-0036 — Testing-first deployment workflow

**Status:** Accepted (2026-07-21)  
**Context:** Pushing feature UI to `main` auto-deploys Production Vercel while Production Supabase migrations lagged, so Production showed new screens without the required RPCs. Financial smokes must never run against live restaurant data.

## Decision

1. **Testing** (`xywgmolpnhimivwmsmpw`) is the **only** environment for development, feature work, database migrations during build, and all functional/financial tests (orders, payments, reopen, reversal, treasury, …).
2. **Production** (`nzwgoavyrshuypkugvzc` + Vercel `niha-yam`) is **operations only** — no financial smoke, no test orders/payments/reopen/reversal, no mutation scripts (see [ADR-0035](./0035-production-readonly-tests.md)).
3. **Release Gate** requires **explicit owner approval** after Testing sign-off. Then, in order:
   1. Apply pending migrations to Production (`pnpm migrate:production` with release flag).
   2. Deploy / confirm Production application version (Vercel from `main`).
   3. **Health Check only** (deployment OK, migrations applied, no critical logs, app loads).
4. A feature that depends on a new migration is **not Production-ready** until that migration is applied on Production. Prefer not landing migration-dependent UI on `main` until the Release Gate, or migrate Production in the same approved release window before declaring done.
5. Every Release ends with a written report: commit hash, migrations applied on Production, confirmation that Testing and Production match (schema + app version).

## Consequences

- During development: `pnpm migrate:testing` only — **not** `migrate:production` / `migrate:schema` without approval.
- `migrate:production` / `migrate:schema` require `NIHA_RELEASE_MIGRATE=1` after owner approval.
- Agents must not invent Production financial tests “to be sure.”
- Operational detail and report template: [`docs/deployment-workflow.md`](../deployment-workflow.md).

## Status

Accepted — supersedes informal “migrate both immediately after every migration file” guidance for day-to-day WIP.
