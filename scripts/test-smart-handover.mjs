import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Smart shift handover — auto Path A + review-only + sheet (Testing).
 *
 *   pnpm test:smart-handover
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
  console.log(`\n[Testing] Smart handover scenarios as ${username}…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  // Clear pending money handovers (Path B)
  const pending0 = (await rpc('list_pending_handovers')).data ?? []
  for (const h of pending0) {
    if (h.kind === 'to_next_shift') {
      await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'smart-test cleanup' })
    } else {
      await rpc('receive_treasury_handover', { p_id: h.id })
    }
  }
  record('01 cleanup pending', true, `n=${pending0.length}`)

  let open = (await rpc('get_open_shift')).data
  if (!open) {
    await expectOk('02 open shift', rpc('open_shift', { p_opening_float: 50 }))
    open = (await rpc('get_open_shift')).data
  } else {
    record('02 open shift', true, 'already open')
  }

  const expected = Number(open?.expected_cash ?? open?.opening_float ?? 50)
  const closed = await expectOk(
    '03 close to_main (auto-execute)',
    rpc('close_shift', {
      p_actual_cash_count: expected,
      p_difference_reason: null,
      p_notes: 'smart handover test',
      p_destination: 'to_main',
    }),
  )
  record(
    '03a auto executed',
    closed?.status === 'executed' && closed?.auto_executed === true,
    `status=${closed?.status}`,
  )
  record(
    '03b review still pending',
    closed?.review_status === 'pending',
    `review=${closed?.review_status}`,
  )

  const pendingAfter = (await rpc('list_pending_handovers')).data ?? []
  record(
    '04 no pending money handover for Path A',
    !pendingAfter.some((h) => h.id === closed?.handover_id),
    `pending=${pendingAfter.length}`,
  )

  const sheet = await expectOk(
    '05 smart sheet',
    rpc('get_smart_shift_sheet', { p_shift_id: closed?.shift_id }),
  )
  record(
    '05a sheet has report + collections',
    !!sheet?.report && !!sheet?.collections && !!sheet?.shift,
  )
  record(
    '05b sheet handover review pending',
    sheet?.handover?.review_status === 'pending',
  )

  const reviewed = await expectOk(
    '06 review approve',
    rpc('review_shift_handover', {
      p_id: closed?.handover_id,
      p_decision: 'approved',
      p_notes: 'مراجعة اختبار — لا حركة مالية',
    }),
  )
  record('06a review approved', reviewed?.review_status === 'approved')
  record(
    '06b money status unchanged',
    reviewed?.money_status === 'executed',
    `money=${reviewed?.money_status}`,
  )

  const liqBefore = (await rpc('liq_get_snapshot')).data
  await expectOk(
    '07 review again (allowed overwrite)',
    rpc('review_shift_handover', {
      p_id: closed?.handover_id,
      p_decision: 'rejected',
      p_notes: 'وجد فرق للمناقشة — التشغيل مستمر',
    }),
  )
  const liqAfter = (await rpc('liq_get_snapshot')).data
  record(
    '07a review does not change liquidity',
    Number(liqBefore?.operating_balance) === Number(liqAfter?.operating_balance) &&
      Number(liqBefore?.reserved_balance) === Number(liqAfter?.reserved_balance),
  )

  // Path B still pending until next open
  await expectOk('08 open for path B', rpc('open_shift', { p_opening_float: 40 }))
  const open2 = (await rpc('get_open_shift')).data
  const expected2 = Number(open2?.expected_cash ?? 40)
  const pathB = await expectOk(
    '09 close to_next_shift',
    rpc('close_shift', {
      p_actual_cash_count: expected2,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_next_shift',
    }),
  )
  record(
    '09a path B stays pending money',
    pathB?.status === 'pending',
    `status=${pathB?.status}`,
  )

  // Cleanup path B so Testing stays usable
  if (pathB?.handover_id) {
    await expectOk(
      '10 reject path B cleanup',
      rpc('reject_shift_handover', {
        p_id: pathB.handover_id,
        p_reason: 'smart-test cleanup path B',
      }),
    )
  } else {
    record('10 reject path B cleanup', false, 'missing id')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nSmart handover: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
