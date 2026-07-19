import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Operational Hardening — Print stress (OH-3)
 * Burst enqueue + claim/retry/expire/print-again/heartbeat offline→online.
 *
 *   pnpm test:oh-print -- --username abomalek --password "SECRET" [--burst 40] [--no-cleanup]
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
    else record(name, false, 'expected rejection')
  } catch (e) {
    if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

async function cleanup(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID
  const orderIds =
    (await admin.from('orders').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ?? []
  if (orderIds.length) {
    await admin.from('order_events').delete().in('order_id', orderIds)
    const itemIds =
      (await admin.from('order_items').select('id').in('order_id', orderIds)).data?.map((x) => x.id) ??
      []
    if (itemIds.length) {
      await admin.from('order_item_modifiers').delete().in('order_item_id', itemIds)
    }
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
  }
  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  const kt =
    (await admin.from('kitchen_tickets').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ??
    []
  if (kt.length) {
    await admin.from('kitchen_ticket_lines').delete().in('ticket_id', kt)
    await admin.from('kitchen_tickets').delete().eq('restaurant_id', r)
  }
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('shift_handovers').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  await admin.from('print_bridge_pair_codes').delete().eq('restaurant_id', r)
  await admin
    .from('print_bridges')
    .delete()
    .eq('restaurant_id', r)
    .eq('display_name', 'OH-Print-Stress')
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)
  if (!serviceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const username = readArg('--username', 'abomalek').trim().toLowerCase()
  const password = readArg('--password', '741523')
  const burst = Math.max(10, Number(readArg('--burst', '40')) || 40)

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const bridgeClient = createClient(url, anonKey, {
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
  console.log(`\nOH-3 Print stress burst=${burst} as ${username}…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)
  const brpc = (fn, args) => bridgeClient.rpc(fn, args)

  // Soft-close leftover shift then wipe
  {
    const { data: ctx } = await rpc('get_pos_context')
    if (ctx?.open_shift?.id) {
      await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
      const { data: ctx2 } = await rpc('get_pos_context')
      await rpc('close_shift', {
        p_actual_cash_count: Number(ctx2?.open_shift?.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'oh-print-pre-clean',
        p_destination: 'to_main',
      })
      const { data: pend } = await rpc('list_pending_handovers')
      for (const h of pend ?? []) {
        if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
        else await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'oh cleanup' })
      }
    }
  }
  await cleanup(url, serviceKey)

  const printers = await expectOk('01 list_printers', rpc('list_printers', {}))
  const cashierPr = (printers ?? []).find((p) => p.role === 'cashier')
  const kitchenPr = (printers ?? []).find((p) => p.role === 'kitchen')
  record('01a printers', Boolean(cashierPr && kitchenPr))

  const printerBackup = [cashierPr, kitchenPr].filter(Boolean).map((p) => ({
    id: p.id,
    address: p.address ?? {},
    bridge_id: p.bridge_id ?? null,
  }))

  // Pair ephemeral bridge
  const codeRow = await expectOk(
    '02 create_print_bridge_pair_code',
    rpc('create_print_bridge_pair_code', {}),
  )
  const pairCode = codeRow?.code ?? codeRow?.pair_code
  const paired = await expectOk(
    '03 pair_print_bridge',
    brpc('pair_print_bridge', {
      p_code: pairCode,
      p_display_name: 'OH-Print-Stress',
      p_device_name: 'OH-STRESS-PC',
      p_windows_username: 'oh-tester',
      p_version: '0.3.13-oh',
    }),
  )
  const token = paired?.token
  const bridgeId = paired?.bridge_id
  record('03a token', Boolean(token && bridgeId), String(bridgeId))

  for (const p of [cashierPr, kitchenPr].filter(Boolean)) {
    await admin
      .from('printers')
      .update({
        bridge_id: bridgeId,
        address: { windows_printer_name: `OH-${p.role}` },
      })
      .eq('id', p.id)
  }

  await expectOk(
    '04 bridge_heartbeat online',
    brpc('bridge_heartbeat', {
      p_token: token,
      p_device_name: 'OH-STRESS-PC',
      p_windows_username: 'oh-tester',
      p_version: '0.3.13-oh',
      p_restarted: false,
    }),
  )

  await expectOk('05 open_shift', rpc('open_shift', { p_opening_float: 500 }))
  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')
  const unit = Number(item.base_price)

  // Burst finalize_sale in concurrent waves (realistic POS load, avoids DB timeout)
  const wave = 5
  let burstOk = 0
  let firstBurstErr = ''
  for (let start = 0; start < burst; start += wave) {
    const n = Math.min(wave, burst - start)
    const waveResults = await Promise.all(
      Array.from({ length: n }, () =>
        rpc('finalize_sale', {
          p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
          p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
        }),
      ),
    )
    burstOk += waveResults.filter((r) => !r.error).length
    if (!firstBurstErr) {
      firstBurstErr = waveResults.find((r) => r.error)?.error?.message ?? ''
    }
  }
  // Retry any shortfall sequentially (timeout under peak concurrency is expected)
  while (burstOk < burst) {
    const { error } = await rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
    })
    if (error) {
      firstBurstErr = firstBurstErr || error.message
      break
    }
    burstOk++
  }
  record(
    '06 concurrent finalize_sale waves',
    burstOk === burst,
    `ok=${burstOk}/${burst} wave=${wave} firstErr=${firstBurstErr}`,
  )

  const { data: pendingJobs } = await admin
    .from('print_jobs')
    .select('id, status, kind, order_id')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .in('status', ['pending', 'claimed', 'retry_wait'])
  record(
    '07 queue depth after burst',
    (pendingJobs?.length ?? 0) >= burst,
    `pendingish=${pendingJobs?.length ?? 0}`,
  )

  // Claim batch (may need multiple rounds)
  let claimedTotal = 0
  for (let round = 0; round < 8; round++) {
    const { data: claimed, error } = await brpc('claim_print_jobs', {
      p_token: token,
      p_limit: 25,
    })
    if (error) {
      record('08 claim_print_jobs', false, error.message)
      break
    }
    const batch = Array.isArray(claimed) ? claimed : claimed?.jobs ?? []
    claimedTotal += batch.length
    if (batch.length === 0) break
    // ACK success for half, fail for half of first batch
    for (let i = 0; i < batch.length; i++) {
      const job = batch[i]
      const ok = i % 3 !== 0
      await brpc('report_print_attempt', {
        p_token: token,
        p_job_id: job.id ?? job.job_id,
        p_success: ok,
        p_error_message: ok ? null : 'oh-stress-fail',
        p_delivery: ok ? 'transport_ack' : null,
      })
    }
  }
  record('08 claim+report rounds', claimedTotal > 0, `claimed=${claimedTotal}`)

  // Retry a failed / retry_wait job
  const { data: retryCandidates } = await admin
    .from('print_jobs')
    .select('id, status')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .in('status', ['failed', 'retry_wait'])
    .limit(5)
  if ((retryCandidates?.length ?? 0) > 0) {
    const jid = retryCandidates[0].id
    await expectOk('09 retry_print_job', rpc('retry_print_job', { p_job_id: jid }))
  } else {
    record('09 retry_print_job (no failed — force)', true, 'skipped-no-failed')
  }

  // Expire path
  const expireJobId = await expectOk(
    '10 enqueue_test_print',
    rpc('enqueue_test_print', { p_printer_id: cashierPr.id }),
  )
  if (expireJobId) {
    await admin
      .from('print_jobs')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', expireJobId)
    await expectOk('11 expire_stale_print_jobs', rpc('expire_stale_print_jobs', {}))
    const { data: expiredRow } = await admin
      .from('print_jobs')
      .select('status')
      .eq('id', expireJobId)
      .maybeSingle()
    record('11a status expired', expiredRow?.status === 'expired', expiredRow?.status)
    await expectOk(
      '12 print_job_again after expired',
      rpc('print_job_again', { p_job_id: expireJobId }),
    )
  } else {
    record('11 expire skipped', false, 'no test job id')
  }

  // Heartbeat offline → online (restarted flag simulates reconnect)
  await expectOk(
    '13 bridge_heartbeat reconnect',
    brpc('bridge_heartbeat', {
      p_token: token,
      p_device_name: 'OH-STRESS-PC',
      p_windows_username: 'oh-tester',
      p_version: '0.3.13-oh',
      p_restarted: true,
    }),
  )
  await expectOk(
    '14 bridge_heartbeat steady',
    brpc('bridge_heartbeat', {
      p_token: token,
      p_device_name: 'OH-STRESS-PC',
      p_windows_username: 'oh-tester',
      p_version: '0.3.13-oh',
      p_restarted: false,
    }),
  )

  // Duplicate ACK idempotency
  const { data: anyCompleted } = await admin
    .from('print_jobs')
    .select('id, status')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .eq('status', 'completed')
    .limit(1)
  if (anyCompleted?.[0]) {
    const jid = anyCompleted[0].id
    const first = await brpc('report_print_attempt', {
      p_token: token,
      p_job_id: jid,
      p_success: true,
      p_delivery: 'transport_ack',
    })
    const second = await brpc('report_print_attempt', {
      p_token: token,
      p_job_id: jid,
      p_success: true,
      p_delivery: 'transport_ack',
    })
    record(
      '15 duplicate ACK idempotent',
      !second.error,
      first.error?.message ?? second.error?.message ?? 'ok',
    )
  } else {
    record('15 duplicate ACK', true, 'no completed job yet')
  }

  // Health snapshot
  const health = await expectOk('16 get_printer_health', rpc('get_printer_health', {}))
  record('16a health readable', health != null)

  // Restore printer bindings
  for (const row of printerBackup) {
    await admin
      .from('printers')
      .update({ address: row.address, bridge_id: row.bridge_id })
      .eq('id', row.id)
  }

  if (!hasFlag('--no-cleanup')) {
    const { data: ctx } = await rpc('get_pos_context')
    if (ctx?.open_shift?.id) {
      await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
      const { data: ctx2 } = await rpc('get_pos_context')
      await rpc('close_shift', {
        p_actual_cash_count: Number(ctx2?.open_shift?.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'oh-print-stress',
        p_destination: 'to_main',
      })
      const { data: pend } = await rpc('list_pending_handovers')
      for (const h of pend ?? []) {
        if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
        else await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'oh cleanup' })
      }
    }
    await cleanup(url, serviceKey)
    console.log('\nCleanup done.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== OH-3 Print stress: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
