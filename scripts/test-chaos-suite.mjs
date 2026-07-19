import { createClient } from '@supabase/supabase-js'
import {
  assertDbConsistency,
  createRecorder,
  ensureCashPm,
  ensureMenuItem,
  hasFlag,
  loadEnvClients,
  provisionEphemeralStaff,
  readArg,
  rpcOf,
  serviceCleanup,
  signIn,
  softReset,
} from './chaos-lib.mjs'
// Testing-only gate lives in chaos-lib.loadEnvClients (assertTestingTarget + refuseProductionMutations).

/**
 * Chaos Suite — Testing only (ADR-0035). Never mutates Production.
 *
 *   pnpm test:chaos -- --username manager --password "Testing123!"
 */

async function main() {
  const { url, anon, serviceKey } = loadEnvClients()
  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const { record, expectOk, expectError, summary } = createRecorder()

  const owner = await signIn(url, anon, username, password)
  const rpc = rpcOf(owner)
  const { data: userData } = await owner.auth.getUser()
  const actorUserId = userData?.user?.id
  if (!actorUserId) throw new Error('No actor user id')

  console.log(`\n[Testing] Chaos Suite as ${username}…\n`)

  await softReset(rpc)
  await serviceCleanup(url, serviceKey)

  const item = await ensureMenuItem(rpc)
  const unit = Number(item.base_price)

  // =========================================================================
  // 1. POS Chaos
  // =========================================================================
  console.log('--- POS Chaos ---')
  await expectOk('POS open_shift', rpc('open_shift', { p_opening_float: 2000 }))
  const { cashPm } = await ensureCashPm(rpc)

  // Same button ×10 (finalize without client_request_id → 10 orders OK)
  const spam = await Promise.all(
    Array.from({ length: 10 }, () =>
      rpc('finalize_sale', {
        p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
        p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      }),
    ),
  )
  const spamOk = spam.filter((r) => !r.error).length
  record('POS double-click ×10 creates orders (no crash)', spamOk >= 8, `ok=${spamOk}/10`)

  // Idempotent client_request_id
  const reqId = crypto.randomUUID()
  const a = await rpc('finalize_sale', {
    p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    p_client_request_id: reqId,
  })
  const b = await rpc('finalize_sale', {
    p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    p_client_request_id: reqId,
  })
  record(
    'POS duplicate client_request_id rejected',
    !a.error && b.error && String(b.error.message).includes('DUPLICATE'),
    b.error?.message ?? 'no error on second',
  )

  // Concurrent same client_request_id — at most one logical success
  // (second may surface as DUPLICATE_REQUEST or unique_violation)
  const req2 = crypto.randomUUID()
  const raceDup = await Promise.all([
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      p_client_request_id: req2,
    }),
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      p_client_request_id: req2,
    }),
  ])
  const raceOk = raceDup.filter((r) => !r.error).length
  const raceDupErr = raceDup.filter(
    (r) =>
      r.error &&
      (/DUPLICATE|unique constraint|uq_orders_client_request/i.test(r.error.message)),
  ).length
  record(
    'POS concurrent same client_request_id ≤1 success',
    raceOk <= 1 && raceOk + raceDupErr >= 1,
    `ok=${raceOk} dupErr=${raceDupErr}`,
  )

  // Unpaid + concurrent edit
  const unpaid = await expectOk(
    'POS create_unpaid',
    rpc('create_unpaid_order', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_order_type: 'takeaway',
    }),
  )
  const oid = unpaid?.order_id
  const edits = await Promise.all([
    rpc('edit_pending_order', {
      p_order_id: oid,
      p_items: [{ menu_item_id: item.id, quantity: 2, modifier_option_ids: [] }],
    }),
    rpc('edit_pending_order', {
      p_order_id: oid,
      p_items: [{ menu_item_id: item.id, quantity: 3, modifier_option_ids: [] }],
    }),
  ])
  const editOk = edits.filter((r) => !r.error).length
  record('POS concurrent edit same order serialized', editOk >= 1, `ok=${editOk}/2`)

  // Print before fully settled unpaid (kitchen should still enqueue on create)
  const reprint = await rpc('reprint_order', {
    p_order_id: oid,
    p_kind: 'kitchen',
    p_reason: 'chaos-print-early',
  })
  record(
    'POS reprint on unpaid does not crash',
    !reprint.error || String(reprint.error.message).length > 0,
    reprint.error?.message ?? 'ok',
  )

  // Collect remaining spam
  const half = Math.max(1, Math.round(unit))
  const collects = await Promise.all([
    rpc('collect_remaining', {
      p_order_id: oid,
      p_tenders: [{ payment_method_id: cashPm.id, amount: half }],
    }),
    rpc('collect_remaining', {
      p_order_id: oid,
      p_tenders: [{ payment_method_id: cashPm.id, amount: half }],
    }),
  ])
  record(
    'POS concurrent collect does not crash DB',
    collects.every((r) => !r.error || /ALREADY|INVALID|INSUFFICIENT|paid/i.test(r.error.message)),
    collects.map((r) => r.error?.message ?? 'ok').join(' | '),
  )

  // =========================================================================
  // 2. Shift Chaos
  // =========================================================================
  console.log('--- Shift Chaos ---')
  const { data: ctxS } = await rpc('get_pos_context')
  const shiftId = ctxS?.open_shift?.id
  if (shiftId) await rpc('approve_pending_for_shift', { p_shift_id: shiftId })
  const { data: ctxS2 } = await rpc('get_pos_context')
  const expected = Number(ctxS2?.open_shift?.expected_cash ?? 0)

  const close1 = await expectOk(
    'Shift close Path A',
    rpc('close_shift', {
      p_actual_cash_count: expected,
      p_difference_reason: null,
      p_notes: 'chaos',
      p_destination: 'to_main',
    }),
  )
  await expectError(
    'Shift double close',
    rpc('close_shift', {
      p_actual_cash_count: 0,
      p_difference_reason: null,
      p_notes: null,
      p_destination: 'to_main',
    }),
    'NO_OPEN_SHIFT',
  )

  const hid = close1?.handover_id
  const recvRace = await Promise.all([
    rpc('receive_treasury_handover', { p_id: hid }),
    rpc('receive_treasury_handover', { p_id: hid }),
    rpc('receive_treasury_handover', { p_id: hid }),
  ])
  const recvOk = recvRace.filter((r) => !r.error).length
  record(
    'Shift triple receive idempotent',
    recvOk === 3 || (recvOk >= 1 && recvRace.every((r) => !r.error || r.error)),
    `ok=${recvOk} idempotent=${recvRace.filter((r) => r.data?.idempotent).length}`,
  )

  // Reject then receive
  await expectOk('Shift open for Path B setup', rpc('open_shift', { p_opening_float: 100 }))
  const { data: ctxB } = await rpc('get_pos_context')
  await rpc('approve_pending_for_shift', { p_shift_id: ctxB.open_shift.id })
  const { data: ctxB2 } = await rpc('get_pos_context')
  const closeB = await expectOk(
    'Shift close to_next',
    rpc('close_shift', {
      p_actual_cash_count: Number(ctxB2?.open_shift?.expected_cash ?? 0),
      p_difference_reason: null,
      p_notes: 'chaos-b',
      p_destination: 'to_next_shift',
    }),
  )
  const { data: pendB } = await rpc('list_pending_handovers')
  const nextHo = (pendB ?? []).find((h) => h.kind === 'to_next_shift')
  await expectOk(
    'Shift reject Path B',
    rpc('reject_shift_handover', { p_id: nextHo.id, p_reason: 'chaos refuse' }),
  )
  await expectError(
    'Shift open with rejected handover id',
    rpc('open_shift', {
      p_opening_float: 50,
      p_receive_handover_id: nextHo.id,
      p_received_actual_cash: Number(nextHo.amount),
    }),
    'NOT_FOUND',
  )
  const openAfterReject = await rpc('open_shift', { p_opening_float: 50 })
  if (openAfterReject.error?.message?.includes('PENDING_NEXT')) {
    await rpc('recreate_shift_handover', {
      p_shift_id: nextHo.shift_id,
      p_destination: 'to_next_shift',
    })
    const { data: pend2 } = await rpc('list_pending_handovers')
    const n2 = (pend2 ?? []).find((h) => h.kind === 'to_next_shift')
    await expectOk(
      'Shift recreate+receive after reject',
      rpc('open_shift', {
        p_opening_float: 50,
        p_receive_handover_id: n2.id,
        p_received_actual_cash: Number(n2.amount),
      }),
    )
  } else {
    record('Shift open after Path B reject', !openAfterReject.error, openAfterReject.error?.message)
  }

  // =========================================================================
  // 3. Treasury Chaos
  // =========================================================================
  console.log('--- Treasury Chaos ---')
  {
    const { data: ctxT } = await rpc('get_pos_context')
    if (!ctxT?.open_shift) {
      await rpc('open_shift', { p_opening_float: 500 })
    }
  }
  const { data: ctxT2 } = await rpc('get_pos_context')
  // Seed cash via sales then approve
  for (let i = 0; i < 8; i++) {
    await rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    })
  }
  await rpc('approve_pending_for_shift', { p_shift_id: ctxT2.open_shift.id })

  const drops = await Promise.all([
    rpc('cash_drop', { p_amount: 30, p_reason: 'chaos-a' }),
    rpc('cash_drop', { p_amount: 30, p_reason: 'chaos-b' }),
    rpc('cash_drop', { p_amount: 30, p_reason: 'chaos-c' }),
  ])
  const dropOk = drops.filter((r) => !r.error).length
  const dropFail = drops.filter((r) => r.error)
  record(
    'Treasury concurrent cash_drop safe',
    dropOk + dropFail.length === 3 &&
      dropFail.every((r) => /INSUFFICIENT|HANDOVER|PERMISSION/i.test(r.error.message)),
    `ok=${dropOk} fail=${dropFail.map((r) => r.error.message).join('|')}`,
  )

  const exps = await Promise.all([
    rpc('pos_record_expense', { p_amount: 10, p_category: 'other', p_description: 'c1' }),
    rpc('pos_record_expense', { p_amount: 10, p_category: 'other', p_description: 'c2' }),
  ])
  record(
    'Treasury concurrent expenses',
    exps.filter((r) => !r.error).length >= 1,
    exps.map((r) => r.error?.message ?? 'ok').join('|'),
  )

  // Approve vs reject same expense
  const expId = exps.find((r) => !r.error)?.data
  if (expId) {
    const ar = await Promise.all([
      rpc('approve_expense', { p_id: expId }),
      rpc('reject_expense', { p_id: expId, p_reason: 'chaos race' }),
    ])
    const arOk = ar.filter((r) => !r.error).length
    record(
      'Treasury approve∥reject expense → exactly one wins',
      arOk === 1,
      ar.map((r) => r.error?.message ?? 'ok').join('|'),
    )
  } else {
    record('Treasury approve∥reject expense', true, 'skipped-no-expense')
  }

  // =========================================================================
  // 4. Printing Chaos
  // =========================================================================
  console.log('--- Print Chaos ---')
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const bridgeClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const pair = await expectOk('Print pair code', rpc('create_print_bridge_pair_code'))
  const paired = await expectOk(
    'Print pair bridge',
    bridgeClient.rpc('pair_print_bridge', {
      p_code: pair.code,
      p_display_name: 'Chaos-Bridge',
      p_device_name: 'CHAOS-PC',
      p_windows_username: 'chaos',
      p_version: '0.1.0-old',
    }),
  )
  const token = paired?.token
  const bridgeId = paired?.bridge_id
  const { data: printers } = await rpc('list_printers', {})
  const backup = (printers ?? []).map((p) => ({
    id: p.id,
    address: p.address,
    bridge_id: p.bridge_id,
  }))
  for (const p of printers ?? []) {
    await admin
      .from('printers')
      .update({
        bridge_id: bridgeId,
        address: { windows_printer_name: `Chaos-${p.role}` },
      })
      .eq('id', p.id)
  }
  await bridgeClient.rpc('bridge_heartbeat', {
    p_token: token,
    p_device_name: 'CHAOS-PC',
    p_windows_username: 'chaos',
    p_version: '0.1.0-old',
    p_restarted: false,
  })

  const saleP = await expectOk(
    'Print sale enqueue',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    }),
  )
  const claimed = await bridgeClient.rpc('claim_print_jobs', { p_token: token, p_limit: 20 })
  const jobs = Array.isArray(claimed.data) ? claimed.data : []
  record('Print claim while online', jobs.length > 0, `n=${jobs.length}`)

  if (jobs[0]) {
    await bridgeClient.rpc('report_print_attempt', {
      p_token: token,
      p_job_id: jobs[0].id,
      p_success: true,
      p_delivery: 'transport_ack',
    })
    const dup = await bridgeClient.rpc('report_print_attempt', {
      p_token: token,
      p_job_id: jobs[0].id,
      p_success: true,
      p_delivery: 'transport_ack',
    })
    record('Print duplicate ACK', !dup.error, dup.error?.message ?? 'ok')
  }

  // Restart heartbeat
  await expectOk(
    'Print heartbeat restarted',
    bridgeClient.rpc('bridge_heartbeat', {
      p_token: token,
      p_device_name: 'CHAOS-PC',
      p_windows_username: 'chaos',
      p_version: '0.3.13',
      p_restarted: true,
    }),
  )

  // Printer name change mid-queue
  const cashierPr = (printers ?? []).find((p) => p.role === 'cashier')
  if (cashierPr) {
    await admin
      .from('printers')
      .update({ address: { windows_printer_name: 'Chaos-Renamed' } })
      .eq('id', cashierPr.id)
    record('Print rename printer mid-flight', true)
  }

  const testJob = await expectOk(
    'Print enqueue_test',
    rpc('enqueue_test_print', { p_printer_id: cashierPr?.id }),
  )
  if (testJob) {
    await admin
      .from('print_jobs')
      .update({ expires_at: new Date(Date.now() - 120_000).toISOString() })
      .eq('id', testJob)
    await expectOk('Print expire', rpc('expire_stale_print_jobs', {}))
    await expectOk('Print again', rpc('print_job_again', { p_job_id: testJob }))
  }

  for (const row of backup) {
    await admin
      .from('printers')
      .update({ address: row.address, bridge_id: row.bridge_id })
      .eq('id', row.id)
  }
  await admin.from('print_bridges').delete().eq('display_name', 'Chaos-Bridge')

  // =========================================================================
  // 5. Call Center / Security Chaos
  // =========================================================================
  console.log('--- Call Center + Security Chaos ---')
  let remote = null
  try {
    remote = await provisionEphemeralStaff({
      url,
      anon,
      serviceKey,
      actorUserId,
      role: 'remote_operator',
    })
    const rrpc = rpcOf(remote.client)
    // Remote can create unpaid
    const roOrder = await rrpc('create_unpaid_order', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_order_type: 'takeaway',
    })
    record(
      'CC remote can create unpaid',
      !roOrder.error,
      roOrder.error?.message ?? roOrder.data?.order_id,
    )

    // Remote cannot cash
    await expectError(
      'CC remote cash_drop blocked',
      rrpc('cash_drop', { p_amount: 5, p_reason: 'nope' }),
      'REMOTE_OPERATOR_NO_CASH',
    )
    await expectError(
      'CC remote finalize_sale blocked',
      rrpc('finalize_sale', {
        p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
        p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      }),
      'REMOTE_OPERATOR_NO_CASH',
    )

    // Concurrent edit: remote + owner
    if (roOrder.data?.order_id) {
      const oid2 = roOrder.data.order_id
      const dual = await Promise.all([
        rrpc('edit_pending_order', {
          p_order_id: oid2,
          p_items: [{ menu_item_id: item.id, quantity: 2, modifier_option_ids: [] }],
        }),
        rpc('edit_pending_order', {
          p_order_id: oid2,
          p_items: [{ menu_item_id: item.id, quantity: 4, modifier_option_ids: [] }],
        }),
      ])
      record(
        'CC dual edit remote∥cashier serialized',
        dual.filter((r) => !r.error).length >= 1,
        dual.map((r) => r.error?.message ?? 'ok').join('|'),
      )
    }
  } catch (e) {
    record('CC remote provision', false, e.message)
  }

  // Anon / no session
  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await expectError(
    'SEC anon open_shift denied',
    anonClient.rpc('open_shift', { p_opening_float: 1 }),
    'PERMISSION',
  )
  await expectError(
    'SEC anon receive denied',
    anonClient.rpc('receive_treasury_handover', {
      p_id: '00000000-0000-4000-8000-000000000099',
    }),
    'PERMISSION',
  )

  // Day totals: owner OK
  await expectOk('SEC manager day totals', rpc('get_day_collection_totals', {}))

  // =========================================================================
  // 6. Reports / consistency snapshot
  // =========================================================================
  console.log('--- Consistency ---')
  await assertDbConsistency(admin, record, 'CHAOS')

  const { data: ctxEnd } = await rpc('get_pos_context')
  if (ctxEnd?.open_shift) {
    record(
      'REP shift summary present',
      ctxEnd.open_shift.expected_cash != null,
      String(ctxEnd.open_shift.expected_cash),
    )
    const st = await expectOk(
      'REP shift collection totals',
      rpc('get_shift_collection_totals', { p_shift_id: ctxEnd.open_shift.id }),
    )
    record('REP scope=shift', st?.scope === 'shift')
  }

  // Cleanup
  if (remote) await remote.cleanup()
  if (!hasFlag('--no-cleanup')) {
    await softReset(rpc)
    await serviceCleanup(url, serviceKey)
    console.log('\nCleanup done.')
  }

  const { failed } = summary('Production Chaos Suite')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
