import {
  assertProductionTarget,
  loadProjectEnv,
} from './load-env.mjs'
import { createScriptClient } from './script-safety.mjs'

/**
 * Production smoke — READ ONLY (ADR-0035).
 * Verifies liquidity + smart-handover RPCs exist; never opens/closes shifts.
 *
 *   pnpm smoke:liq-handover-production -- --username U --password P
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
      'Usage: pnpm smoke:liq-handover-production -- --username U --password P',
    )
    process.exit(1)
  }

  const sb = createScriptClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_ANON_KEY,
    { mode: 'readonly' },
  )
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error(authErr.message)
    process.exit(1)
  }
  console.log(
    `\n[Production READ-ONLY] Smoke as ${username} — no mutations…\n`,
  )
  const rpc = (fn, args) => sb.rpc(fn, args)

  {
    const { data, error } = await rpc('liq_get_snapshot')
    record(
      '01 liq_get_snapshot',
      !error && data?.operating_pct != null,
      error?.message ?? `op=${data?.operating_pct} res=${data?.reserved_pct}`,
    )
  }

  {
    const { data, error } = await rpc('get_open_shift')
    record(
      '02 get_open_shift (read)',
      !error,
      error?.message ?? (data?.reference ? `open=${data.reference}` : 'no open shift'),
    )
  }

  {
    const { data, error } = await rpc('list_pending_handovers')
    record(
      '03 list_pending_handovers',
      !error && Array.isArray(data),
      error?.message ?? `n=${(data ?? []).length}`,
    )
  }

  {
    const { error } = await rpc('get_treasury_balances')
    record('04 get_treasury_balances', !error, error?.message)
  }

  // Prove mutations are blocked by policy wrapper
  {
    const { error } = await rpc('close_shift', {
      p_actual_cash_count: 0,
      p_difference_reason: null,
      p_notes: 'must be blocked',
      p_destination: 'to_main',
    })
    record(
      '05 close_shift blocked on Production',
      !!error && String(error.message).includes('PRODUCTION_READONLY'),
      error?.message ?? 'UNEXPECTED: mutation was allowed',
    )
  }

  {
    const { error } = await rpc('open_shift', { p_opening_float: 1 })
    record(
      '06 open_shift blocked on Production',
      !!error && String(error.message).includes('PRODUCTION_READONLY'),
      error?.message ?? 'UNEXPECTED: mutation was allowed',
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nProduction smoke liq+handover (READ-ONLY): ${results.length - failed.length}/${results.length}` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
