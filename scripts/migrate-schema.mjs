/**
 * Keep Production and Testing schemas in sync at Release Gate.
 *
 * ADR-0036: do NOT use this during day-to-day WIP.
 * Development → pnpm migrate:testing only.
 * After owner approval → NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema
 *
 * Seed / demo data → Testing ONLY (never Production).
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function run(script) {
  const result = spawnSync(process.execPath, [resolve(script)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Child migrate-production also checks this flag.
      NIHA_RELEASE_MIGRATE: process.env.NIHA_RELEASE_MIGRATE ?? '',
    },
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (process.env.NIHA_RELEASE_MIGRATE !== '1') {
  console.error(
    'REFUSED: Schema sync touches Production (ADR-0036).\n' +
      '  After owner approval on Testing, run:\n' +
      '    NIHA_RELEASE_MIGRATE=1 pnpm migrate:schema\n' +
      '  During development use:\n' +
      '    pnpm migrate:testing\n' +
      '  See docs/deployment-workflow.md',
  )
  process.exit(1)
}

console.log('══ Release schema sync: Production + Testing ══')
console.log('  Seed will NOT run (Testing-only).\n')

console.log('── 1/2 Production ──')
run('scripts/migrate-production.mjs')

console.log('\n── 2/2 Testing ──')
run('scripts/migrate-testing.mjs')

console.log('\nOK: Production and Testing schemas match the repo migrations.')
console.log('  Next: confirm Production app deploy + Health Check only.')
console.log('  Report template: docs/deployment-workflow.md')
