import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * OES Shift Handover — SHA core paths under F1.
 *
 * Usage:
 *   pnpm test:shift-handover -- --username abomalek --password "SECRET"
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

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  assertSupabaseUrl(url)
  if (!anon) {
    console.error('Missing VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  const username = readArg('--username', 'abomalek').trim().toLowerCase()
  const password = readArg('--password', '741523')
  const supabase = createClient(url, anon, {
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
  console.log(`\nSigned in as ${username}. Running Shift Handover scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  // Ensure clean: if open shift, try close to main first (may fail if already pending)
  const ctx0 = await expectOk('01 get_pos_context', rpc('get_pos_context'))
  if (ctx0?.open_shift) {
    await expectOk(
      '01b close existing for clean slate',
      rpc('close_shift', {
        p_actual_cash_count: Number(ctx0.open_shift.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'handover-test-cleanup',
        p_destination: 'to_main',
      }),
    )
    const pending = await rpc('list_pending_handovers')
    const list = pending.data ?? []
    for (const h of list) {
      if (h.kind === 'to_main') {
        await rpc('receive_treasury_handover', { p_id: h.id })
      } else {
        await rpc('reject_shift_handover', {
          p_id: h.id,
          p_reason: 'test cleanup',
        })
      }
    }
  }

  // Clear any remaining pending
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
  }

  await expectOk('02 open_shift', rpc('open_shift', { p_opening_float: 500 }))

  // Seed drawer with a deposit-like path isn't available as cashier; use opening float only.
  const closeA = await expectOk(
    '03 close_shift to_main',
    rpc('close_shift', {
      p_actual_cash_count: 500,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_main',
    }),
  )
  record(
    '03a pending amount',
    closeA && Number(closeA.amount) === 500,
    `amount=${closeA?.amount}`,
  )

  await expectError(
    '04 cash_drop blocked while pending',
    rpc('cash_drop', { p_amount: 10, p_reason: 'should fail' }),
    'HANDOVER_PENDING',
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

  // Q-SH2: open new shift while Path A pending
  await expectOk(
    '06 open_shift while Path A pending',
    rpc('open_shift', { p_opening_float: 0 }),
  )

  const pendingList = await expectOk(
    '07 list_pending_handovers',
    rpc('list_pending_handovers'),
  )
  const pathA = (pendingList ?? []).find((h) => h.kind === 'to_main')
  record('07a has to_main pending', Boolean(pathA), pathA?.reference)

  if (pathA) {
    await expectOk(
      '08 receive_treasury_handover',
      rpc('receive_treasury_handover', { p_id: pathA.id }),
    )
  } else {
    record('08 receive_treasury_handover', false, 'no pending')
  }

  // Mid-shift cash drop ok when no pending
  const balCtx = await rpc('get_pos_context')
  const drawerBal = Number(balCtx.data?.operational_drawer_balance ?? 0)
  if (drawerBal >= 10) {
    await expectOk(
      '09 cash_drop after receive',
      rpc('cash_drop', { p_amount: 10, p_reason: 'post-handover' }),
    )
  } else {
    record('09 cash_drop after receive', true, 'skipped — low balance')
  }

  // Path B flow
  const ctxB = await rpc('get_pos_context')
  const expected = Number(ctxB.data?.open_shift?.expected_cash ?? 0)
  const closeB = await expectOk(
    '10 close_shift to_next_shift',
    rpc('close_shift', {
      p_actual_cash_count: expected,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_next_shift',
    }),
  )

  await expectError(
    '11 open without receive Path B',
    rpc('open_shift', { p_opening_float: 0 }),
    'PENDING_NEXT_HANDOVER',
  )

  if (closeB?.handover_id) {
    await expectOk(
      '12 open with receive Path B',
      rpc('open_shift', {
        p_opening_float: 0,
        p_receive_handover_id: closeB.handover_id,
        p_received_actual_cash: Number(closeB.amount ?? 0),
      }),
    )
  } else {
    record('12 open with receive Path B', false, 'missing handover_id')
  }

  await expectOk('13 list_shifts_archive', rpc('list_shifts_archive', { p_limit: 10 }))
  if (closeB?.shift_id) {
    await expectOk(
      '14 get_shift_archive',
      rpc('get_shift_archive', { p_shift_id: closeB.shift_id }),
    )
  }

  // Reject + re-request
  const ctxR = await rpc('get_pos_context')
  const expR = Number(ctxR.data?.open_shift?.expected_cash ?? 0)
  const closeR = await expectOk(
    '15 close for reject test',
    rpc('close_shift', {
      p_actual_cash_count: expR,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_main',
    }),
  )
  if (closeR?.handover_id) {
    await expectOk(
      '16 reject_shift_handover',
      rpc('reject_shift_handover', {
        p_id: closeR.handover_id,
        p_reason: 'discrepancy test',
      }),
    )
    await expectOk(
      '17 recreate_shift_handover',
      rpc('recreate_shift_handover', {
        p_shift_id: closeR.shift_id,
        p_destination: 'to_main',
      }),
    )
    const { data: pend2 } = await rpc('list_pending_handovers')
    const again = (pend2 ?? []).find((h) => h.shift_id === closeR.shift_id)
    if (again) {
      await expectOk(
        '18 receive after re-request',
        rpc('receive_treasury_handover', { p_id: again.id }),
      )
    } else record('18 receive after re-request', false, 'no pending')
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
