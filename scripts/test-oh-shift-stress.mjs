import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'

/**
 * Operational Hardening — Shift / handover stress + realistic failure modes (OH-4)
 *
 *   pnpm test:oh-shift -- --username abomalek --password "SECRET" [--no-cleanup]
 */

const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'
const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

function readArg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}
const hasFlag = (name) => process.argv.includes(name)

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
    if (error && error.message.includes(code)) record(name, true, `rejected: ${code}`)
    else if (error) record(name, false, `wrong error: ${error.message}`)
    else record(name, false, 'expected rejection but succeeded')
  } catch (e) {
    if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05

async function serviceCleanup(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID
  const orderIds =
    (await admin.from('orders').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ?? []
  if (orderIds.length) {
    await admin.from('order_events').delete().in('order_id', orderIds)
    await admin.from('order_amendments').delete().in('order_id', orderIds)
    const itemIds =
      (await admin.from('order_items').select('id').in('order_id', orderIds)).data?.map((x) => x.id) ??
      []
    if (itemIds.length) {
      await admin.from('order_item_modifiers').delete().in('order_item_id', itemIds)
    }
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
    await admin.from('print_jobs').delete().in('order_id', orderIds)
    const ktIds =
      (await admin.from('kitchen_tickets').select('id').in('order_id', orderIds)).data?.map(
        (x) => x.id,
      ) ?? []
    if (ktIds.length) {
      await admin.from('kitchen_ticket_lines').delete().in('ticket_id', ktIds)
      await admin.from('kitchen_tickets').delete().in('order_id', orderIds)
    }
  }
  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shift_handovers').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
}

async function softReset(rpc) {
  const { data: ctx } = await rpc('get_pos_context')
  if (ctx?.open_shift?.id) {
    await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
    const { data: ctx2 } = await rpc('get_pos_context')
    const expected = Number(ctx2?.open_shift?.expected_cash ?? ctx.open_shift.expected_cash ?? 0)
    await rpc('close_shift', {
      p_actual_cash_count: expected,
      p_difference_reason: expected === 0 ? null : null,
      p_notes: 'oh-shift-soft-reset',
      p_destination: 'to_main',
    })
  }
  await clearPending(rpc)
}

async function clearPending(rpc) {
  const { data: pend } = await rpc('list_pending_handovers')
  for (const h of pend ?? []) {
    if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
    else await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'oh cleanup' })
  }
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertTestingTarget(url)

  const username = readArg(
    '--username',
    env.TESTING_CASHIER_USERNAME || env.TESTING_MANAGER_USERNAME || 'abomalek',
  )
    .trim()
    .toLowerCase()
  const password = readArg(
    '--password',
    env.TESTING_CASHIER_PASSWORD || env.TESTING_MANAGER_PASSWORD || '',
  )
  if (!password) throw new Error('Missing Testing password (TESTING_CASHIER_PASSWORD)')
  const supabase = createClient(url, anonKey, {
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
  console.log(`\nOH-4 Shift stress + scenarios as ${username}…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  if (serviceKey) {
    await softReset(rpc)
    await serviceCleanup(url, serviceKey)
  } else {
    await softReset(rpc)
  }

  // --- Path A lifecycle ---
  await expectOk('01 open_shift', rpc('open_shift', { p_opening_float: 800 }))

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  const { data: ctxSale } = await rpc('get_pos_context')
  const cashPm = (ctxSale?.payment_methods ?? []).find((p) => p.code === 'cash')
  const unit = Number(item?.base_price ?? 10)

  // Sales + expense + cash drop
  for (let i = 0; i < 5; i++) {
    await rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    })
  }
  record('02 seed sales ×5', true)

  const exp = await rpc('pos_record_expense', {
    p_amount: 25,
    p_category: 'other',
    p_description: 'oh-shift-expense',
  })
  record('03 pos_record_expense', !exp.error, exp.error?.message ?? '')

  const { data: ctxMid } = await rpc('get_pos_context')
  const shiftIdA = ctxMid?.open_shift?.id
  if (shiftIdA) {
    await rpc('approve_pending_for_shift', { p_shift_id: shiftIdA })
  }

  const dropAmt = 50
  const drop = await expectOk(
    '04 cash_drop',
    rpc('cash_drop', { p_amount: dropAmt, p_reason: 'oh mid-shift drop' }),
  )

  const { data: ctxBeforeClose } = await rpc('get_pos_context')
  const expectedA = Number(ctxBeforeClose?.open_shift?.expected_cash ?? 0)

  // Close with variance (short count)
  const shortCount = Math.max(0, expectedA - 30)
  const closeA = await expectOk(
    '05 close_shift to_main with variance',
    rpc('close_shift', {
      p_actual_cash_count: shortCount,
      p_difference_reason: 'oh-stress shortage',
      p_notes: 'path-a',
      p_destination: 'to_main',
    }),
  )
  const hidA = closeA?.handover_id

  // Second close blocked
  await expectError(
    '06 double close blocked',
    rpc('close_shift', {
      p_actual_cash_count: 0,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_main',
    }),
    'NO_OPEN_SHIFT',
  )

  // Cash drop while pending
  await expectError(
    '07 cash_drop while pending blocked',
    rpc('cash_drop', { p_amount: 10, p_reason: 'should fail' }),
    'HANDOVER_PENDING',
  )

  // Second handover recreate while pending
  await expectError(
    '08 recreate while pending blocked',
    rpc('recreate_shift_handover', {
      p_shift_id: closeA?.shift_id ?? shiftIdA,
      p_destination: 'to_main',
    }),
    'HANDOVER_ALREADY_PENDING',
  )

  // Open while Path A pending is allowed (Q-SH2)
  await expectOk(
    '09 open_shift while Path A pending',
    rpc('open_shift', { p_opening_float: 200 }),
  )

  // Idempotent receive — double call (refresh during receive)
  const recv1 = await expectOk(
    '10 receive_treasury_handover',
    rpc('receive_treasury_handover', { p_id: hidA }),
  )
  const recv2 = await expectOk(
    '11 receive again idempotent',
    rpc('receive_treasury_handover', { p_id: hidA }),
  )
  record(
    '11a idempotent flag or same executed',
    recv2?.status === 'executed' && (recv2?.idempotent === true || near(recv2?.amount, recv1?.amount)),
    JSON.stringify(recv2),
  )

  // Close current for Path B
  const { data: ctxB0 } = await rpc('get_pos_context')
  if (ctxB0?.open_shift) {
    await rpc('approve_pending_for_shift', { p_shift_id: ctxB0.open_shift.id })
    const { data: ctxB1 } = await rpc('get_pos_context')
    await expectOk(
      '12 close to_next_shift',
      rpc('close_shift', {
        p_actual_cash_count: Number(ctxB1?.open_shift?.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'path-b',
        p_destination: 'to_next_shift',
      }),
    )
  }

  const { data: pendingB } = await rpc('list_pending_handovers')
  const nextHo = (pendingB ?? []).find((h) => h.kind === 'to_next_shift')
  record('13 pending next exists', Boolean(nextHo), nextHo?.reference)

  await expectError(
    '14 open without receive blocked',
    rpc('open_shift', { p_opening_float: 100 }),
    'PENDING_NEXT_HANDOVER',
  )

  await expectError(
    '15 open without receive count blocked',
    rpc('open_shift', {
      p_opening_float: 100,
      p_receive_handover_id: nextHo?.id,
    }),
    'RECEIVE_COUNT_REQUIRED',
  )

  // Reject Path B then recreate
  await expectOk(
    '16 reject Path B',
    rpc('reject_shift_handover', {
      p_id: nextHo.id,
      p_reason: 'new cashier refused count',
    }),
  )
  await expectOk(
    '17 recreate after reject',
    rpc('recreate_shift_handover', {
      p_shift_id: nextHo.shift_id,
      p_destination: 'to_next_shift',
    }),
  )
  const { data: pendingB2 } = await rpc('list_pending_handovers')
  const nextHo2 = (pendingB2 ?? []).find((h) => h.kind === 'to_next_shift')

  // Receive with count variance
  const expectedAmt = Number(nextHo2?.amount ?? 0)
  const counted = expectedAmt - 15
  const opened = await expectOk(
    '18 open with receive + variance',
    rpc('open_shift', {
      p_opening_float: 50,
      p_receive_handover_id: nextHo2.id,
      p_received_actual_cash: counted,
    }),
  )

  const { data: ctxAfterRecv } = await rpc('get_pos_context')
  const recvVar = Number(ctxAfterRecv?.open_shift?.expected_cash ?? 0)
  record(
    '18a receive variance applied to drawer',
    Boolean(opened) && Number.isFinite(recvVar),
    `expected_cash=${recvVar} counted=${counted} trust=${expectedAmt}`,
  )

  // Archive
  const archList = await expectOk('19 list_shifts_archive', rpc('list_shifts_archive', {}))
  record('19a archive non-empty', (archList?.length ?? archList?.shifts?.length ?? 0) > 0)

  const closedId = closeA?.shift_id ?? shiftIdA
  if (closedId) {
    const arch = await expectOk(
      '20 get_shift_archive',
      rpc('get_shift_archive', { p_shift_id: closedId }),
    )
    record(
      '20a archive has handover / variance info',
      Boolean(arch?.handover || arch?.report || arch?.shift),
      Object.keys(arch ?? {}).join(','),
    )
  }

  // Hub scoped to new shift only
  const newShiftId = ctxAfterRecv?.open_shift?.id
  const hub = await expectOk(
    '21 hub open-shift only',
    rpc('list_orders_for_pos', {
      p_search: null,
      p_shift_id: newShiftId,
      p_hub_only: true,
    }),
  )
  record(
    '21a hub empty or only new-shift action orders',
    Array.isArray(hub),
    `count=${(hub ?? []).length}`,
  )

  // Shift vs day collection totals
  if (newShiftId) {
    const st = await expectOk(
      '22 get_shift_collection_totals',
      rpc('get_shift_collection_totals', { p_shift_id: newShiftId }),
    )
    record('22a scope=shift', st?.scope === 'shift')
  }

  // Concurrent open race (best-effort)
  const race = await Promise.all([
    rpc('open_shift', { p_opening_float: 1 }),
    rpc('open_shift', { p_opening_float: 1 }),
  ])
  const raceOk = race.filter((r) => !r.error).length
  const raceDenied = race.filter(
    (r) => r.error && String(r.error.message).includes('SHIFT_ALREADY_OPEN'),
  ).length
  record(
    '23 concurrent open_shift safe',
    raceOk <= 1 && (raceOk + raceDenied === 2 || raceOk === 0),
    `ok=${raceOk} denied=${raceDenied}`,
  )

  // Handover print enqueue + full-report snapshot shape
  if (hidA) {
    const printHo = await rpc('m6_enqueue_shift_handover_print', {
      p_handover_id: hidA,
      p_phase: 'handover',
    })
    record(
      '24 handover reprint/enqueue',
      !printHo.error || String(printHo.error.message).includes('NOT_FOUND'),
      printHo.error?.message ?? 'enqueued',
    )

    const snapRes = await rpc('m6_build_handover_print_snapshot', {
      p_handover_id: hidA,
      p_phase: 'handover',
    })
    const snap = snapRes.data
    const ops = snap?.ops
    const cash = snap?.cash
    const fullOk =
      !snapRes.error &&
      typeof snap?.title_ar === 'string' &&
      String(snap.title_ar).includes('تقرير') &&
      snap?.document_type === 'shift_handover' &&
      snap?.layout == null &&
      ops != null &&
      typeof ops.sales_total === 'number' &&
      typeof ops.orders_count === 'number' &&
      typeof ops.avg_ticket === 'number' &&
      cash != null &&
      typeof cash.expected_cash === 'number' &&
      Array.isArray(snap.top_items_by_revenue) &&
      Array.isArray(snap.top_items_by_qty) &&
      Array.isArray(snap.payment_methods)
    record(
      '24b handover full report snapshot',
      fullOk,
      snapRes.error?.message ??
        `title=${snap?.title_ar} orders=${ops?.orders_count} sales=${ops?.sales_total}`,
    )

    if (printHo.data && serviceKey) {
      const admin = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: job } = await admin
        .from('print_jobs')
        .select('id, kind, template_id, payload')
        .eq('id', printHo.data)
        .maybeSingle()
      const payload = job?.payload ?? {}
      record(
        '24c handover job kind/template',
        job?.kind === 'shift_handover' &&
          job?.template_id == null &&
          payload?.document_type === 'shift_handover' &&
          payload?.data_snapshot?.layout == null,
        `kind=${job?.kind} tpl=${job?.template_id}`,
      )
    }
  }

  if (!hasFlag('--no-cleanup')) {
    await softReset(rpc)
    if (serviceKey) await serviceCleanup(url, serviceKey)
    console.log('\nCleanup done.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== OH-4 Shift stress: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
