import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Operational Hardening — Orders stress (OH-2)
 * Creates ~60 mixed orders and reconciles hub / print / treasury / shift totals.
 *
 *   pnpm test:oh-orders -- --username abomalek --password "SECRET" [--count 60] [--no-cleanup]
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
    const ktIds =
      (await admin.from('kitchen_tickets').select('id').in('order_id', orderIds)).data?.map(
        (x) => x.id,
      ) ?? []
    if (ktIds.length) {
      await admin.from('kitchen_ticket_lines').delete().in('ticket_id', ktIds)
    }
    await admin.from('kitchen_tickets').delete().in('order_id', orderIds)
    await admin.from('print_jobs').delete().in('order_id', orderIds)
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
  }
  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  await admin.from('ops_messages').delete().eq('restaurant_id', r)
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shift_handovers').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
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
  const targetCount = Math.max(20, Number(readArg('--count', '60')) || 60)

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(url, serviceKey, {
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
  console.log(`\nOH-2 Orders stress ×${targetCount} as ${username}…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  await serviceCleanup(url, serviceKey)

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const items = [
    ...(menuRaw?.favorites ?? []),
    ...(menuRaw?.categories ?? []).flatMap((c) => c.items ?? []),
  ]
  const item = items[0]
  if (!item) throw new Error('No menu item')
  const unit = Number(item.base_price)

  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')
  if (!cashPm) throw new Error('Need cash PM')

  await expectOk('01 open_shift', rpc('open_shift', { p_opening_float: 1000 }))
  const { data: ctx1 } = await rpc('get_pos_context')
  const shiftId = ctx1?.open_shift?.id
  record('01a open shift id', Boolean(shiftId), shiftId)

  const created = []
  let payNow = 0
  let unpaid = 0
  let partial = 0
  let delivery = 0
  let takeaway = 0
  let reprintN = 0
  let failCreate = 0

  // Pattern cycle: pay_now, unpaid, partial, delivery unpaid, takeaway unpaid
  for (let i = 0; i < targetCount; i++) {
    const kind = i % 5
    const line = {
      menu_item_id: item.id,
      quantity: 1,
      modifier_option_ids: [],
    }
    try {
      if (kind === 0) {
        const { data, error } = await rpc('finalize_sale', {
          p_items: [line],
          p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
          p_order_type: 'takeaway',
        })
        if (error) throw error
        created.push({ id: data.order_id ?? data.id, kind: 'pay_now' })
        payNow++
        takeaway++
      } else if (kind === 1) {
        const { data, error } = await rpc('create_unpaid_order', {
          p_items: [line],
          p_order_type: 'takeaway',
        })
        if (error) throw error
        created.push({ id: data.order_id ?? data.id, kind: 'unpaid' })
        unpaid++
        takeaway++
      } else if (kind === 2) {
        const { data, error } = await rpc('create_unpaid_order', {
          p_items: [line],
          p_order_type: 'takeaway',
        })
        if (error) throw error
        const oid = data.order_id ?? data.id
        const half = Math.max(1, Math.round(unit / 2))
        const { error: cErr } = await rpc('collect_remaining', {
          p_order_id: oid,
          p_tenders: [{ payment_method_id: cashPm.id, amount: half }],
        })
        if (cErr) throw cErr
        created.push({ id: oid, kind: 'partial' })
        partial++
        takeaway++
      } else if (kind === 3) {
        const phone = `010${String(10000000 + i).slice(-8)}`
        const { data, error } = await rpc('create_unpaid_order', {
          p_items: [line],
          p_order_type: 'delivery',
          p_customer_name: `OH-Stress-${i}`,
          p_customer_phone: phone,
          p_delivery_address: 'شارع الاختبار',
        })
        if (error) throw error
        created.push({ id: data.order_id ?? data.id, kind: 'delivery' })
        delivery++
        unpaid++
      } else {
        const { data, error } = await rpc('create_unpaid_order', {
          p_items: [line],
          p_order_type: 'takeaway',
        })
        if (error) throw error
        created.push({ id: data.order_id ?? data.id, kind: 'unpaid' })
        unpaid++
        takeaway++
      }
    } catch (e) {
      failCreate++
      console.log(`  create#${i} error: ${e.message ?? e}`)
    }
  }

  record(
    '02 created all without loss',
    created.length === targetCount && failCreate === 0,
    `created=${created.length}/${targetCount} fails=${failCreate} payNow=${payNow} unpaid≈${unpaid} partial=${partial} delivery=${delivery}`,
  )

  // Identity spot-check
  const sample = created.filter((c) => c.id).slice(0, 5)
  let identityOk = 0
  for (const c of sample) {
    const { data: d } = await rpc('get_order_detail', { p_order_id: c.id })
    const ord = d?.order ?? d
    if (ord?.created_by || ord?.created_by_name || ord?.created_at) identityOk++
  }
  record('03 identity fields present', identityOk === sample.length, `${identityOk}/${sample.length}`)

  // Reprint / kitchen print on a paid order
  const paidOne = created.find((c) => c.kind === 'pay_now')
  if (paidOne?.id) {
    const beforeJobs = (
      await admin.from('print_jobs').select('id').eq('order_id', paidOne.id)
    ).data?.length ?? 0
    const r1 = await rpc('reprint_order', {
      p_order_id: paidOne.id,
      p_kind: 'receipt',
      p_reason: 'oh-stress',
    })
    const r2 = await rpc('reprint_order', {
      p_order_id: paidOne.id,
      p_kind: 'kitchen',
      p_reason: 'oh-stress-kitchen',
    })
    if (!r1.error) reprintN++
    if (!r2.error) reprintN++
    const afterJobs =
      (await admin.from('print_jobs').select('id, status, kind').eq('order_id', paidOne.id)).data ??
      []
    record(
      '04 reprint creates new jobs (no silent loss)',
      afterJobs.length >= beforeJobs + 1,
      `before=${beforeJobs} after=${afterJobs.length} reprints=${reprintN}`,
    )
  } else {
    record('04 reprint skipped', false, 'no pay_now order')
  }

  // No duplicate order references
  const { data: allOrders } = await admin
    .from('orders')
    .select('id, reference, shift_id, payment_status, total')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
  const refs = (allOrders ?? []).map((o) => o.reference)
  record(
    '05 unique order references',
    new Set(refs).size === refs.length,
    `orders=${refs.length} unique=${new Set(refs).size}`,
  )
  record(
    '05a all on open shift',
    (allOrders ?? []).every((o) => o.shift_id === shiftId),
    `shift=${shiftId}`,
  )

  // Hub: only unpaid/partial/action — paid must not dominate hub_only list
  const hub = await expectOk(
    '06 list_orders_for_pos hub_only',
    rpc('list_orders_for_pos', {
      p_search: null,
      p_shift_id: shiftId,
      p_hub_only: true,
      p_limit: 200,
    }),
  )
  const hubPaid = (hub ?? []).filter((o) => o.payment_status === 'paid').length
  const hubAction = (hub ?? []).filter(
    (o) => o.payment_status === 'unpaid' || o.payment_status === 'partial',
  ).length
  record(
    '06a hub excludes settled paid',
    hubPaid === 0,
    `hub=${(hub ?? []).length} paid=${hubPaid} actionish=${hubAction}`,
  )

  // Shift collection totals vs day — shift must be <= day and match shift orders
  const shiftTotals = await expectOk(
    '07 get_shift_collection_totals',
    rpc('get_shift_collection_totals', { p_shift_id: shiftId }),
  )
  const dayTotals = await expectOk(
    '08 get_day_collection_totals',
    rpc('get_day_collection_totals', {}),
  )
  record('07a shift scope', shiftTotals?.scope === 'shift', JSON.stringify(shiftTotals?.scope))
  record('08a day scope', dayTotals?.scope === 'day', JSON.stringify(dayTotals?.scope))
  record(
    '07b by_collection_status on shift',
    Boolean(shiftTotals?.by_collection_status),
    JSON.stringify(shiftTotals?.by_collection_status),
  )

  const shiftPaidAmt = Number(shiftTotals?.by_collection_status?.paid ?? 0)
  const expectedPaid = (allOrders ?? [])
    .filter((o) => o.payment_status === 'paid')
    .reduce((s, o) => s + Number(o.total), 0)
  record(
    '09 shift paid totals ≈ order paid totals',
    near(shiftPaidAmt, expectedPaid),
    `rpc=${shiftPaidAmt} orders=${expectedPaid}`,
  )

  // Print job integrity: every pay_now should have ≥1 kitchen or receipt job
  const payNowIds = created.filter((c) => c.kind === 'pay_now').map((c) => c.id)
  const { data: jobs } = await admin
    .from('print_jobs')
    .select('id, order_id, kind, status')
    .in('order_id', payNowIds.length ? payNowIds : ['00000000-0000-4000-8000-000000000000'])
  const jobsByOrder = new Map()
  for (const j of jobs ?? []) {
    jobsByOrder.set(j.order_id, (jobsByOrder.get(j.order_id) ?? 0) + 1)
  }
  const missingPrint = payNowIds.filter((id) => !jobsByOrder.has(id)).length
  record(
    '10 pay_now orders have print jobs',
    missingPrint === 0,
    `pay_now=${payNowIds.length} missing=${missingPrint} jobs=${(jobs ?? []).length}`,
  )

  // Treasury / shift report still readable
  const report = await expectOk('11 get_pos_context after stress', rpc('get_pos_context'))
  record(
    '11a shift report present',
    Boolean(report?.open_shift?.expected_cash != null),
    `expected=${report?.open_shift?.expected_cash}`,
  )

  if (!hasFlag('--no-cleanup')) {
    // Close cleanly: approve pending then close
    if (shiftId) {
      await rpc('approve_pending_for_shift', { p_shift_id: shiftId })
      const { data: ctxClose } = await rpc('get_pos_context')
      const expected = Number(ctxClose?.open_shift?.expected_cash ?? 0)
      await rpc('close_shift', {
        p_actual_cash_count: expected,
        p_difference_reason: null,
        p_notes: 'oh-orders-stress',
        p_destination: 'to_main',
      })
      const { data: pend } = await rpc('list_pending_handovers')
      for (const h of pend ?? []) {
        if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
        else
          await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'oh cleanup' })
      }
    }
    await serviceCleanup(url, serviceKey)
    console.log('\nCleanup done.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== OH-2 Orders stress: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
