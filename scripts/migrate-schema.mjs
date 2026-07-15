/**
 * Keep Production and Testing schemas in sync.
 *
 * Policy:
 * - Migrations + Edge Functions → BOTH environments
 * - Seed / demo data → Testing ONLY (never Production)
 *
 * Usage: pnpm migrate:schema
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function run(script) {
  const result = spawnSync(process.execPath, [resolve(script)], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('══ Schema sync: Production + Testing ══')
console.log('  Seed will NOT run (Testing-only).\n')

console.log('── 1/2 Production ──')
run('scripts/migrate-production.mjs')

console.log('\n── 2/2 Testing ──')
run('scripts/migrate-testing.mjs')

console.log('\nOK: Production and Testing schemas match the repo migrations.')
console.log('  Next (optional, Testing only): pnpm seed:testing')
