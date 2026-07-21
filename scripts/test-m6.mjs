import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * M6A — print jobs registry, queue lifecycle, reprint, health (no hardware).
 *
 * Usage:
 *   pnpm test:m6 -- --username abomalek --password "SECRET" [--no-cleanup]
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
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`)
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

async function serviceCleanup(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID

  const orderIds =
    (await admin.from('orders').select('id').eq('restaurant_id', r)).data?.map(
      (x) => x.id,
    ) ?? []

  if (orderIds.length) {
    await admin.from('order_events').delete().in('order_id', orderIds)
    await admin.from('order_amendments').delete().in('order_id', orderIds)
    const itemIds =
      (
        await admin.from('order_items').select('id').in('order_id', orderIds)
      ).data?.map((x) => x.id) ?? []
    if (itemIds.length) {
      await admin.from('order_item_modifiers').delete().in('order_item_id', itemIds)
    }
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
  }

  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  const kt =
    (await admin.from('kitchen_tickets').select('id').eq('restaurant_id', r)).data?.map(
      (x) => x.id,
    ) ?? []
  if (kt.length) {
    await admin.from('kitchen_ticket_lines').delete().in('ticket_id', kt)
    await admin.from('kitchen_tickets').delete().eq('restaurant_id', r)
  }
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  // keep seed printers/templates; only remove ephemeral test bridges
  await admin
    .from('print_bridges')
    .delete()
    .eq('restaurant_id', r)
    .like('display_name', 'M6A-%')
}

async function restorePrinterBindings(admin, backup) {
  for (const row of backup ?? []) {
    await admin
      .from('printers')
      .update({ address: row.address, bridge_id: row.bridge_id })
      .eq('id', row.id)
  }
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)

  const username = readArg('--username', 'abomalek').trim().toLowerCase()
  const password = readArg('--password', '741523')

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (signInError) {
    console.error(`FAIL: sign in: ${signInError.message}`)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running M6A scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)

  await serviceCleanup(url, serviceKey)

  {
    const { data: leftover } = await rpc('get_open_shift')
    if (leftover?.id) {
      await rpc('heal_residual_pending_for_shift', { p_shift_id: leftover.id })
      await rpc('close_shift', {
        p_actual_cash_count: Number(leftover.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'm6a reset',
      })
    }
  }

  await expectOk('01 open_shift', rpc('open_shift', { p_opening_float: 500 }))

  const printers = await expectOk('02 list_printers', rpc('list_printers', {}))
  const cashierPr = (printers ?? []).find((p) => p.role === 'cashier')
  const kitchenPr = (printers ?? []).find((p) => p.role === 'kitchen')
  record('02a cashier + kitchen printers', Boolean(cashierPr && kitchenPr),
    `cashier=${cashierPr?.name} kitchen=${kitchenPr?.name}`)

  // Ensure Windows spooler name for Print Center → Bridge path (restored in finally)
  const printerAddressBackup = []
  for (const p of [cashierPr, kitchenPr].filter(Boolean)) {
    printerAddressBackup.push({
      id: p.id,
      address: p.address ?? {},
      bridge_id: p.bridge_id ?? null,
    })
    await admin
      .from('printers')
      .update({ address: { windows_printer_name: `M6A-${p.role}-Printer` } })
      .eq('id', p.id)
  }

  const templates = await expectOk('03 list_print_templates', rpc('list_print_templates'))
  record(
    '03a receipt + kitchen templates',
    (templates ?? []).some((t) => t.kind === 'receipt') &&
      (templates ?? []).some((t) => t.kind === 'kitchen'),
    `count=${templates?.length}`,
  )

  const preview = await expectOk(
    '04 preview_print_template(kitchen)',
    rpc('preview_print_template', { p_kind: 'kitchen' }),
  )
  record(
    '04a kitchen preview forbids prices',
    preview?.sample_data?.forbid_prices === true ||
      preview?.template?.body?.forbid_prices === true,
  )

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  if (!item) throw new Error('No menu item')

  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')
  if (!cashPm) throw new Error('Need cash method')

  const sale = await expectOk(
    '05 finalize_sale → auto print jobs',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: Number(item.base_price) + 10 }],
    }),
  )

  const orderId = sale?.order_id
  let jobsBefore = []
  if (orderId) {
    const { data: jobs } = await admin
      .from('print_jobs')
      .select('id, kind, status, is_reprint')
      .eq('order_id', orderId)
    jobsBefore = jobs ?? []
    record(
      '05a print jobs created (receipt + kitchen)',
      jobsBefore.length >= 2 &&
        jobsBefore.every((j) => j.status === 'pending') &&
        jobsBefore.some((j) => j.kind === 'receipt') &&
        jobsBefore.some((j) => j.kind === 'kitchen'),
      `jobs=${jobsBefore.length} kinds=${jobsBefore.map((j) => j.kind).join(',')}`,
    )
    const { data: routed } = await admin
      .from('print_jobs')
      .select('id, kind, printer_id, bridge_id, payload')
      .eq('order_id', orderId)
    record(
      '05b jobs stamped printer_id + bridge_id + snapshot',
      (routed ?? []).length >= 1 &&
        (routed ?? []).every(
          (j) =>
            j.printer_id &&
            j.bridge_id &&
            j.payload?.data_snapshot?.order_reference,
        ),
      `n=${routed?.length} sample=${JSON.stringify({
        printer_id: routed?.[0]?.printer_id,
        bridge_id: routed?.[0]?.bridge_id,
        has_snap: Boolean(routed?.[0]?.payload?.data_snapshot),
      })}`,
    )
  }

  const bridgeId = await expectOk(
    '06 upsert_print_bridge_heartbeat',
    rpc('upsert_print_bridge_heartbeat', {
      p_id: null,
      p_display_name: 'M6A Test Bridge',
      p_device_name: 'TEST-PC',
      p_windows_username: 'tester',
      p_version: '0.1.0-m6a',
      p_restarted: true,
    }),
  )

  const health = await expectOk('07 get_printer_health', rpc('get_printer_health'))
  record(
    '07a health has queue + bridge',
    health?.queue != null && (health?.bridge != null || (health?.bridges?.length ?? 0) > 0),
    `pending=${health?.queue?.pending}`,
  )

  // Claim must use the bridge stamped on jobs (multi-bridge ownership)
  const saleBridgeId =
    (
      await admin
        .from('print_jobs')
        .select('bridge_id')
        .eq('order_id', orderId)
        .not('bridge_id', 'is', null)
        .limit(1)
        .maybeSingle()
    ).data?.bridge_id ?? bridgeId

  const claimed = await expectOk(
    '08 claim_print_jobs',
    rpc('claim_print_jobs', { p_bridge_id: saleBridgeId, p_limit: 10 }),
  )
  record('08a claimed >= 1', Array.isArray(claimed) && claimed.length >= 1, `n=${claimed?.length}`)

  const firstJob = claimed?.[0]?.id
  if (firstJob) {
    await expectOk(
      '09 report failure (offline queue)',
      rpc('report_print_attempt', {
        p_job_id: firstJob,
        p_success: false,
        p_error_code: 'OFFLINE',
        p_error_message: 'printer offline',
        p_bridge_id: saleBridgeId,
      }),
    )
    const { data: afterFail } = await admin
      .from('print_jobs')
      .select('status, attempt_count, last_error')
      .eq('id', firstJob)
      .single()
    record(
      '09a job retry_wait or failed',
      afterFail?.status === 'retry_wait' || afterFail?.status === 'failed',
      afterFail?.status,
    )
    record('09b attempt recorded', Number(afterFail?.attempt_count) >= 1)

    await expectOk('10 retry_print_job', rpc('retry_print_job', { p_job_id: firstJob }))
    const { data: afterRetry } = await admin
      .from('print_jobs')
      .select('status')
      .eq('id', firstJob)
      .single()
    record('10a back to pending', afterRetry?.status === 'pending', afterRetry?.status)

    // claim + success (auto-print recovery)
    await rpc('claim_print_jobs', { p_bridge_id: saleBridgeId, p_limit: 10 })
    await expectOk(
      '11 report success',
      rpc('report_print_attempt', {
        p_job_id: firstJob,
        p_success: true,
        p_bridge_id: saleBridgeId,
      }),
    )
    const { data: done } = await admin
      .from('print_jobs')
      .select('status')
      .eq('id', firstJob)
      .single()
    record('11a completed', done?.status === 'completed', done?.status)
  }

  await expectError(
    '12 reprint without reason',
    rpc('reprint_order', { p_order_id: orderId, p_kind: 'receipt', p_reason: '' }),
    'REASON_REQUIRED',
  )

  const reprintId = await expectOk(
    '13 reprint_order with reason',
    rpc('reprint_order', {
      p_order_id: orderId,
      p_kind: 'receipt',
      p_reason: 'ورقة العميل تالفة',
    }),
  )

  await expectOk(
    '13b reprint kitchen document',
    rpc('reprint_order', {
      p_order_id: orderId,
      p_kind: 'kitchen',
      p_reason: 'ورقة المطبخ ناقصة',
    }),
  )

  if (orderId) {
    const timeline = await expectOk(
      '14 order timeline has print',
      rpc('get_order_timeline', { p_order_id: orderId }),
    )
    const types = (timeline ?? []).map((e) => e.event_type)
    record(
      '14a timeline print.enqueued',
      types.includes('print.enqueued'),
      types.filter((t) => t.startsWith('print')).join(','),
    )

    const summary = await expectOk(
      '15 get_order_print_summary',
      rpc('get_order_print_summary', { p_order_id: orderId }),
    )
    record(
      '15a reprint_count >= 1',
      Number(summary?.reprint_count ?? 0) >= 1,
      `reprint_count=${summary?.reprint_count}`,
    )

    const { data: audits } = await admin
      .from('audit_log')
      .select('action')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .eq('action', 'order.reprinted')
      .order('created_at', { ascending: false })
      .limit(3)
    record('16 audit order.reprinted', (audits ?? []).length >= 1, `n=${audits?.length}`)
  }

  if (reprintId) {
    await expectOk(
      '17 cancel_print_job',
      rpc('cancel_print_job', { p_job_id: reprintId, p_reason: 'اختبار إلغاء' }),
    )
    const againId = await expectOk(
      '18 print_job_again',
      rpc('print_job_again', { p_job_id: reprintId }),
    )
    record('18a new job id', Boolean(againId) && againId !== reprintId)
  }

  if (cashierPr?.id) {
    const testId = await expectOk(
      '19 enqueue_test_print',
      rpc('enqueue_test_print', { p_printer_id: cashierPr.id }),
    )
    const { data: testJob } = await admin
      .from('print_jobs')
      .select('kind, order_id, status')
      .eq('id', testId)
      .single()
    record(
      '19a test_page pending no order',
      testJob?.kind === 'test_page' && testJob?.order_id == null && testJob?.status === 'pending',
      JSON.stringify(testJob),
    )
  }

  // Failure recovery: exhaust retries → failed → retry
  const failJob = await expectOk(
    '20 enqueue job for failure recovery',
    rpc('enqueue_test_print', { p_printer_id: kitchenPr.id }),
  )
  if (failJob) {
    const failBridge =
      (
        await admin
          .from('print_jobs')
          .select('bridge_id')
          .eq('id', failJob)
          .maybeSingle()
      ).data?.bridge_id ?? saleBridgeId
    await admin.from('print_jobs').update({ max_attempts: 2 }).eq('id', failJob)
    await rpc('claim_print_jobs', { p_bridge_id: failBridge, p_limit: 20 })
    await rpc('report_print_attempt', {
      p_job_id: failJob,
      p_success: false,
      p_error_code: 'NO_PAPER',
      p_bridge_id: failBridge,
    })
    // force next attempt immediately
    await admin
      .from('print_jobs')
      .update({ next_attempt_at: new Date(0).toISOString(), status: 'retry_wait' })
      .eq('id', failJob)
    await rpc('claim_print_jobs', { p_bridge_id: failBridge, p_limit: 20 })
    await rpc('report_print_attempt', {
      p_job_id: failJob,
      p_success: false,
      p_error_code: 'NO_PAPER',
      p_bridge_id: failBridge,
    })
    const { data: failedRow } = await admin
      .from('print_jobs')
      .select('status')
      .eq('id', failJob)
      .single()
    record('20a exhausted → failed', failedRow?.status === 'failed', failedRow?.status)
    await expectOk('20b retry after failed', rpc('retry_print_job', { p_job_id: failJob }))
  }

  // Policy: unpaid create → kitchen only; collection → receipt
  const unpaid = await expectOk(
    '21 create_unpaid_order kitchen-only print',
    rpc('create_unpaid_order', {
      p_items: [{ menu_item_id: item.id, quantity: 1 }],
      p_order_type: 'takeaway',
    }),
  )
  if (unpaid?.order_id) {
    const { data: uj } = await admin
      .from('print_jobs')
      .select('kind')
      .eq('order_id', unpaid.order_id)
    const kinds = (uj ?? []).map((j) => j.kind)
    record(
      '21a unpaid has kitchen, no receipt',
      kinds.includes('kitchen') && !kinds.includes('receipt'),
      kinds.join(','),
    )
    const collect = await expectOk(
      '22 record_collection enqueues receipt',
      rpc('record_collection', {
        p_order_id: unpaid.order_id,
        p_tenders: [
          {
            payment_method_id: cashPm.id,
            amount: Number(item.base_price),
          },
        ],
      }),
    )
    record('22a payment ids', Array.isArray(collect?.payment_ids), JSON.stringify(collect))
    const { data: afterCollect } = await admin
      .from('print_jobs')
      .select('kind')
      .eq('order_id', unpaid.order_id)
    record(
      '22b receipt after collection',
      (afterCollect ?? []).some((j) => j.kind === 'receipt'),
      (afterCollect ?? []).map((j) => j.kind).join(','),
    )
  }

  await supabase.auth.signOut()

  await restorePrinterBindings(admin, printerAddressBackup)

  if (!hasFlag('--no-cleanup')) {
    await serviceCleanup(url, serviceKey)
    console.log('\nCleanup: M6A test data removed.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M6A review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
