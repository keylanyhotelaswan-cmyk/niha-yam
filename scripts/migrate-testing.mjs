/**
 * Apply all repo migrations to the Testing Supabase project via the
 * IPv4 connection pooler (direct db.* host is IPv6-only and often unreachable).
 *
 * Schema policy: migrations apply to BOTH Production and Testing.
 * Prefer `pnpm migrate:schema` after adding a migration so both stay matched.
 * Seed remains Testing-only (`pnpm seed:testing`) — never run here.
 *
 * Requires SUPABASE_DB_PASSWORD in `.env.testing` (run `pnpm env:testing`).
 * Restores the CLI project-ref to Production afterwards.
 *
 * Usage: pnpm migrate:testing
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  PRODUCTION_SUPABASE_REF,
  TESTING_SUPABASE_REF,
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'

const PROJECT_REF_PATH = resolve('supabase/.temp/project-ref')

/** Frankfurt pooler (Testing project region: Central EU). */
const TESTING_POOLER_HOST = 'aws-0-eu-central-1.pooler.supabase.com'

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function buildDbUrl(password) {
  const user = `postgres.${TESTING_SUPABASE_REF}`
  const enc = encodeURIComponent(password)
  // Session mode (5432) — required for DDL / migrations
  return `postgresql://${user}:${enc}@${TESTING_POOLER_HOST}:5432/postgres`
}

function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)

  const password =
    env.SUPABASE_DB_PASSWORD ||
    env.POSTGRES_PASSWORD ||
    env.DATABASE_PASSWORD
  const explicitUrl = env.SUPABASE_DB_URL || env.DATABASE_URL

  if (!password && !explicitUrl) {
    console.error(
      'FAIL: Set SUPABASE_DB_PASSWORD in .env.testing (Dashboard → Project Settings → Database),\n' +
        '      then re-run: pnpm env:testing   OR add the password manually and retry.',
    )
    process.exit(1)
  }

  const dbUrl = explicitUrl || buildDbUrl(password)

  mkdirSync(dirname(PROJECT_REF_PATH), { recursive: true })
  const previous = existsSync(PROJECT_REF_PATH)
    ? readFileSync(PROJECT_REF_PATH, 'utf8').trim()
    : PRODUCTION_SUPABASE_REF

  // Keep .temp ref in sync for any CLI side-effects, but push uses --db-url.
  writeFileSync(PROJECT_REF_PATH, TESTING_SUPABASE_REF + '\n', 'utf8')

  try {
    console.log(`→ Pushing migrations to Testing via pooler (${TESTING_POOLER_HOST})…`)
    run('supabase', ['db', 'push', '--yes', '--db-url', dbUrl])

    console.log('→ Deploying Edge Functions to Testing…')
    run('supabase', [
      'functions',
      'deploy',
      '--project-ref',
      TESTING_SUPABASE_REF,
    ])
  } finally {
    console.log(`→ Restoring CLI link to ${previous || PRODUCTION_SUPABASE_REF}…`)
    writeFileSync(
      PROJECT_REF_PATH,
      (previous || PRODUCTION_SUPABASE_REF) + '\n',
      'utf8',
    )
  }

  console.log('OK: Testing schema + functions are up to date.')
  console.log('  Production link restored:', previous || PRODUCTION_SUPABASE_REF)
}

main()
