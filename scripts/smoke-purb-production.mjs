import {
  assertProductionTarget,
  loadProjectEnv,
} from './load-env.mjs'
import { createScriptClient } from './script-safety.mjs'

/**
 * PURB Production smoke — READ ONLY (ADR-0035).
 * Confirms credit-ledger RPCs exist; never posts credit/pay/reverse.
 *
 *   node scripts/smoke-purb-production.mjs -- --username U --password P
 */

const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

function readArg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const env = loadProjectEnv()
  assertProductionTarget(env.VITE_SUPABASE_URL)

  const username = readArg('--username')
  const password = readArg('--password')
  if (!username || !password) {
    console.error(
      'Usage: node scripts/smoke-purb-production.mjs -- --username U --password P',
    )
    process.exit(1)
  }

  const supabase = createScriptClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_ANON_KEY,
    { mode: 'readonly' },
  )
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error(authErr.message)
    process.exit(1)
  }
  console.log(
    `\n[Production READ-ONLY] Signed in as ${username}. PURB smoke…\n`,
  )
  const rpc = (fn, args) => supabase.rpc(fn, args)

  for (const [name, fn, args] of [
    ['01 list_suppliers', 'list_suppliers', {}],
    ['02 list_ingredients', 'list_ingredients', { p_active_only: true }],
    ['03 get_treasury_balances', 'get_treasury_balances', {}],
  ]) {
    const { error } = await rpc(fn, args)
    record(name, !error, error?.message)
  }

  {
    const { error } = await rpc('pur_post_credit_purchase', {
      p_supplier_id: null,
      p_lines: [],
      p_notes: 'blocked',
    })
    record(
      '04 pur_post_credit_purchase blocked',
      !!error && String(error.message).includes('PRODUCTION_READONLY'),
      error?.message ?? 'UNEXPECTED allow',
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nPURB Production smoke (READ-ONLY): ${results.length - failed.length}/${results.length}`,
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
