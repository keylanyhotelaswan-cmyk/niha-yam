import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'
import { testingStaffCredentials } from './testing-credentials.mjs'

/**
 * OES Shift Handover — Path A auto-execute + Path B pending (Testing).
 *
 * Usage:
 *   pnpm test:shift-handover
 */

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

async function expectError(name, promise, code) {
  try {
    const { error } = await promise
    if (error && error.message.includes(code))
      record(name, true, `rejected: ${code}`)
    else if (error) record(name, false, `wrong error: ${error.message}`)
    else record(name, false, 'expected rejection but succeeded')
  } catch (e) {
    if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

function countArgs(open) {
  const physical = Number(open?.physical_drawer_balance ?? open?.expected_cash ?? 0)
  const expected = Number(open?.expected_cash ?? physical)
  const diff = Math.abs(physical - expected)
  return {
    physical,
    expected,
    p_actual_cash_count: physical,
    p_difference_reason: diff > 0.009 ? 'handover-test variance' : null,
  }
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)
  if (!anon) {
    console.error('Missing VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  const { username, password, email } = testingStaffCredentials()
  const supabase = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running Shift Handover scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  // Cleanup pending Path B / leftover money handovers
  {
    const { data: pend } = await rpc('list_pending_handovers')
    for (const h of pend ?? []) {
      if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
      else
        await rpc('reject_shift_handover', {
          p_id: h.id,
          p_reason: 'test cleanup',
        })
    }
    record('01 cleanup pending', true, `n=${(pend ?? []).length}`)
  }

  // Close leftover open shift with physical count
  {
    const open0 = (await rpc('get_open_shift')).data
    if (open0?.id) {
      const c = countArgs(open0)
      await expectOk(
        '01b close existing for clean slate',
        rpc('close_shift', {
          p_actual_cash_count: c.p_actual_cash_count,
          p_difference_reason: c.p_difference_reason,
          p_notes: 'handover-test-cleanup',
          p_destination: 'to_main',
        }),
      )
    } else {
      record('01b close existing for clean slate', true, 'none open')
    }
  }

  await expectOk('02 open_shift', rpc('open_shift', { p_opening_float: 500 }))

  const openA = (await rpc('get_open_shift')).data
  const cA = countArgs(openA)
  const closeA = await expectOk(
    '03 close_shift to_main (auto-execute)',
    rpc('close_shift', {
      p_actual_cash_count: cA.p_actual_cash_count,
      p_difference_reason: cA.p_difference_reason,
      p_notes: null,
      p_destination: 'to_main',
    }),
  )
  record(
    '03a auto executed',
    closeA && (closeA.status === 'executed' || closeA.auto_executed === true),
    `status=${closeA?.status} auto=${closeA?.auto_executed} amount=${closeA?.amount}`,
  )
  record(
    '03b review still pending',
    closeA?.review_status === 'pending',
    `review=${closeA?.review_status}`,
  )

  // Path A no longer blocks ops with HANDOVER_PENDING money receive
  const pendingAfterA = (await rpc('list_pending_handovers')).data ?? []
  record(
    '04 no pending money handover for Path A',
    !pendingAfterA.some((h) => h.id === closeA?.handover_id),
    `pending=${pendingAfterA.length}`,
  )

  await expectError(
    '05 second close blocked (no open shift)',
    rpc('close_shift', {
      p_actual_cash_count: 0,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_main',
    }),
    'NO_OPEN_SHIFT',
  )

  await expectOk('06 open_shift after Path A', rpc('open_shift', { p_opening_float: 0 }))

  // Mid-shift cash drop ok when no pending Path B
  const balCtx = await rpc('get_pos_context')
  const drawerBal = Number(balCtx.data?.operational_drawer_balance ?? 0)
  if (drawerBal >= 10) {
    await expectOk(
      '07 cash_drop after Path A',
      rpc('cash_drop', { p_amount: 10, p_reason: 'post-handover' }),
    )
  } else {
    record('07 cash_drop after Path A', true, 'skipped — low balance')
  }

  // Path B flow — stays pending until next open receives it
  const openB = (await rpc('get_open_shift')).data
  const cB = countArgs(openB)
  const closeB = await expectOk(
    '08 close_shift to_next_shift',
    rpc('close_shift', {
      p_actual_cash_count: cB.p_actual_cash_count,
      p_difference_reason: cB.p_difference_reason,
      p_notes: null,
      p_destination: 'to_next_shift',
    }),
  )
  record(
    '08a path B stays pending money',
    closeB?.status === 'pending',
    `status=${closeB?.status}`,
  )

  await expectError(
    '09 open without receive Path B',
    rpc('open_shift', { p_opening_float: 0 }),
    'PENDING_NEXT_HANDOVER',
  )

  if (closeB?.handover_id) {
    await expectOk(
      '10 open with receive Path B',
      rpc('open_shift', {
        p_opening_float: 0,
        p_receive_handover_id: closeB.handover_id,
        p_received_actual_cash: Number(closeB.amount ?? 0),
      }),
    )
  } else {
    record('10 open with receive Path B', false, 'missing handover_id')
  }

  await expectOk('11 list_shifts_archive', rpc('list_shifts_archive', { p_limit: 10 }))
  if (closeB?.shift_id) {
    await expectOk(
      '12 get_shift_archive',
      rpc('get_shift_archive', { p_shift_id: closeB.shift_id }),
    )
  } else {
    record('12 get_shift_archive', true, 'skipped')
  }

  // Reject + re-request Path B (money pending); Path A auto-executes so reject is review-oriented
  const openR = (await rpc('get_open_shift')).data
  const cR = countArgs(openR)
  const closeR = await expectOk(
    '13 close for path B reject test',
    rpc('close_shift', {
      p_actual_cash_count: cR.p_actual_cash_count,
      p_difference_reason: cR.p_difference_reason,
      p_notes: null,
      p_destination: 'to_next_shift',
    }),
  )
  if (closeR?.handover_id) {
    await expectOk(
      '14 reject_shift_handover',
      rpc('reject_shift_handover', {
        p_id: closeR.handover_id,
        p_reason: 'discrepancy test',
      }),
    )
    await expectOk(
      '15 recreate_shift_handover',
      rpc('recreate_shift_handover', {
        p_shift_id: closeR.shift_id,
        p_destination: 'to_next_shift',
      }),
    )
    const { data: pend2 } = await rpc('list_pending_handovers')
    const again = (pend2 ?? []).find((h) => h.shift_id === closeR.shift_id)
    if (again) {
      // Leave Testing usable: reject cleanup rather than open
      await expectOk(
        '16 cleanup re-request Path B',
        rpc('reject_shift_handover', {
          p_id: again.id,
          p_reason: 'handover-test cleanup',
        }),
      )
    } else record('16 cleanup re-request Path B', false, 'no pending')
  } else {
    record('14 reject_shift_handover', false, 'missing handover')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\n${results.length - failed.length}/${results.length} passed.` +
      (failed.length ? ` Failed: ${failed.map((f) => f.name).join(', ')}` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})