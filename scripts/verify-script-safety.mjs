/**
 * Static check: protected scripts must not be able to mutate Production.
 *
 *   pnpm verify:script-safety
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  isProtectedScriptName,
  isProductionSupabaseUrl,
  refuseProductionMutations,
  createScriptClient,
  isReadOnlyRpcName,
  productionReadOnlyBanner,
  productionWriteBlockedBanner,
} from './script-safety.mjs'
import { PRODUCTION_SUPABASE_REF, TESTING_SUPABASE_REF } from './load-env.mjs'

const dir = path.resolve('scripts')
const files = fs.readdirSync(dir).filter((f) => /\.(mjs|js|ts)$/.test(f))

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// Unit: name detection
record(
  '01 detect smoke/test/sim/fuzz/chaos names',
  isProtectedScriptName('scripts/smoke-pura-production.mjs') &&
    isProtectedScriptName('scripts/test-m4.mjs') &&
    isProtectedScriptName('scripts/simulate-ops-day.mjs') &&
    isProtectedScriptName('scripts/test-chaos-fuzz.mjs') &&
    !isProtectedScriptName('scripts/migrate-production.mjs') &&
    !isProtectedScriptName('scripts/verify-supabase.mjs'),
)

record(
  '02 production URL detect',
  isProductionSupabaseUrl(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`) &&
    !isProductionSupabaseUrl(`https://${TESTING_SUPABASE_REF}.supabase.co`),
)

record('03 readonly rpc allowlist', isReadOnlyRpcName('liq_get_snapshot') && !isReadOnlyRpcName('close_shift'))

record(
  '03b Production banners',
  productionReadOnlyBanner().includes('PRODUCTION MODE') &&
    productionReadOnlyBanner().includes('Read Only') &&
    productionWriteBlockedBanner().includes('Production Write Blocked') &&
    productionWriteBlockedBanner().includes('NIHA_ALLOW_PROD_MUTATION=1'),
)

// refuseProductionMutations throws on Production for protected argv
{
  const prev = process.argv[1]
  process.argv[1] = path.resolve('scripts/test-m4.mjs')
  let threw = false
  try {
    refuseProductionMutations(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)
  } catch {
    threw = true
  }
  process.argv[1] = prev
  record('04 refuse Production mutations for test-*', threw)
}

// readonly client blocks close_shift
{
  const prev = process.argv[1]
  process.argv[1] = path.resolve('scripts/smoke-liquidity-handover-production.mjs')
  const client = createScriptClient(
    `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder',
    { mode: 'readonly' },
  )
  const { error } = await client.rpc('close_shift', {
    p_actual_cash_count: 0,
    p_difference_reason: null,
    p_notes: 'x',
    p_destination: 'to_main',
  })
  process.argv[1] = prev
  record(
    '05 Production readonly client blocks close_shift',
    !!error && String(error.message).includes('PRODUCTION_READONLY'),
    error?.message,
  )
}

// Static scan
const prodReadonlyOk = new Set([
  'smoke-liquidity-handover-production.mjs',
  'smoke-pura-production.mjs',
  'smoke-purb-production.mjs',
  'smoke-ops-purchase-production.mjs',
  'smoke-print-diag-arabic.mjs',
])

for (const f of files) {
  if (!isProtectedScriptName(path.join(dir, f))) continue
  if (f.startsWith('_')) continue
  if (f === 'script-safety.mjs' || f === 'verify-script-safety.mjs') continue

  const src = fs.readFileSync(path.join(dir, f), 'utf8')
  const usesDb =
    src.includes('createClient') ||
    src.includes('createScriptClient') ||
    src.includes('supabase')

  if (!usesDb) {
    record(`scan ${f}`, true, 'no DB client (local unit)')
    continue
  }

  if (prodReadonlyOk.has(f)) {
    const ok =
      src.includes('createScriptClient') &&
      (src.includes("mode: 'readonly'") ||
        src.includes('mode: which === \'production\' ? \'readonly\'') ||
        src.includes('READ ONLY') ||
        src.includes('READ-ONLY'))
    record(`scan ${f} Production read-only`, ok, ok ? '' : 'missing createScriptClient readonly')
    continue
  }

  const ok =
    src.includes('assertTestingTarget') ||
    src.includes('loadTestingEnv') ||
    src.includes('refuseProductionMutations') ||
    // Chaos entrypoints delegate the gate to chaos-lib.loadEnvClients()
    (src.includes('loadEnvClients') && src.includes('chaos-lib'))
  record(
    `scan ${f} Testing-only gate`,
    ok,
    ok
      ? ''
      : 'missing assertTestingTarget / loadTestingEnv / refuseProductionMutations / chaos-lib gate',
  )
}

const failed = results.filter((r) => !r.ok)
console.log(
  `\nverify-script-safety: ${results.length - failed.length}/${results.length}` +
    (failed.length ? ` · failed: ${failed.map((f) => f.name).join(', ')}` : ''),
)
process.exit(failed.length ? 1 : 0)
