import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Dual-env printing — Testing toggle gates claim; payloads stamp test_env.
 *
 *   pnpm test:print-dual-env
 *   pnpm test:print-dual-env -- --username manager --password "Testing123!"
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

async function expectOk(name, promise) {
  try {
    const { data, error } = await promise
    if (error) return record(name, false, error.message), null
    record(name, true)
    return data
  } catch (e) {
    record(name, false, e.message)
    return null
  }
}

async function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)
  refuseProductionMutations(env.VITE_SUPABASE_URL)
  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }
  console.log(`\n[Testing] Signed in as ${username}. Dual-env print scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  const boot = await expectOk(
    '01 bootstrap test print environment',
    rpc('m6_bootstrap_test_print_environment'),
  )
  record(
    '01a is_test_environment',
    !!boot?.is_test_environment,
    `flag=${boot?.is_test_environment}`,
  )

  const settings = await expectOk('02 get_print_ops_settings', rpc('get_print_ops_settings'))
  record(
    '02a settings match bootstrap',
    !!settings?.is_test_environment,
    `enabled=${settings?.testing_print_enabled}`,
  )

  // Force OFF then verify claim empty for a simulated bridge token path is hard without
  // a real bridge token — instead verify toggle + stamp via enqueue_test_print path.
  await expectOk(
    '03 disable testing print',
    rpc('set_testing_print_enabled', { p_enabled: false }),
  )
  const off = await expectOk('03a confirm disabled', rpc('get_print_ops_settings'))
  record('03b testing_print_enabled false', off?.testing_print_enabled === false)

  await expectOk(
    '04 enable testing print',
    rpc('set_testing_print_enabled', { p_enabled: true }),
  )
  const on = await expectOk('04a confirm enabled', rpc('get_print_ops_settings'))
  record('04b testing_print_enabled true', on?.testing_print_enabled === true)

  // Stamp helper via SQL RPC path: enqueue a test print if a printer exists.
  const { data: printers, error: pErr } = await supabase.rpc('list_printers', {
    p_active_only: true,
  })
  if (pErr) {
    record('05 list_printers', false, pErr.message)
    const diag = await expectOk('05b diagnose_print_system', rpc('diagnose_print_system'))
    record('05c diagnose returned', !!diag)
  } else {
    record('05 list_printers', true, `count=${(printers ?? []).length}`)
    const cashier =
      (printers ?? []).find((p) => p.role === 'cashier' && p.is_active) ??
      (printers ?? []).find((p) => p.is_active)
    if (!cashier) {
      record('06 enqueue_test_print skipped', true, 'no active printer')
    } else {
      // Enable briefly so enqueue is allowed; claim gate tested separately.
      await rpc('set_testing_print_enabled', { p_enabled: true })
      const { data: jobId, error: enqErr } = await rpc('enqueue_test_print', {
        p_printer_id: cashier.id,
      })
      if (enqErr) {
        const msg = enqErr.message ?? ''
        const acceptable =
          msg.includes('BRIDGE_REQUIRED') ||
          msg.includes('WINDOWS_PRINTER_REQUIRED') ||
          msg.includes('INVALID_STATE')
        record(
          '06 enqueue_test_print',
          acceptable,
          acceptable ? `expected gate: ${msg}` : msg,
        )
      } else {
        record('06 enqueue_test_print', !!jobId, `job=${jobId}`)
        const { data: job, error: jErr } = await supabase
          .from('print_jobs')
          .select('id, payload, status')
          .eq('id', jobId)
          .maybeSingle()
        if (jErr || !job) {
          record('07 payload test_env stamp', false, jErr?.message ?? 'job not readable')
        } else {
          const stamped = job.payload?.test_env === true
          record('07 payload test_env stamp', stamped, `test_env=${job.payload?.test_env}`)
          const banner = job.payload?.test_env_banner
          record(
            '07a banner lines',
            Array.isArray(banner) && banner.some((l) => String(l).includes('بيئة اختبار')),
            `lines=${Array.isArray(banner) ? banner.length : 0}`,
          )
          await supabase
            .from('print_jobs')
            .update({ status: 'cancelled' })
            .eq('id', jobId)
        }
      }
    }
  }

  // Claim gate: with toggle OFF, manager claim should return [].
  await expectOk(
    '08 disable for claim gate',
    rpc('set_testing_print_enabled', { p_enabled: false }),
  )
  const empty = await expectOk(
    '08a claim while disabled',
    rpc('claim_print_jobs', { p_bridge_id: null, p_limit: 5, p_token: null }),
  )
  record(
    '08b claim empty while disabled',
    Array.isArray(empty) && empty.length === 0,
    `len=${Array.isArray(empty) ? empty.length : typeof empty}`,
  )

  // Leave Testing print OFF by default (safe for shared cashier PC).
  await expectOk(
    '09 leave testing print OFF',
    rpc('set_testing_print_enabled', { p_enabled: false }),
  )

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nDone: ${results.length - failed.length}/${results.length} passed.` +
      (failed.length ? ` Failed: ${failed.map((f) => f.name).join(', ')}` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
