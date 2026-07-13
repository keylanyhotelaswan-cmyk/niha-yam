import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * M5C — pay now/later, Collected/Remaining, pending edit, review queue.
 *
 * Usage:
 *   pnpm test:m5c -- --username abomalek --password "SECRET" [--no-cleanup]
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
    if (error) {
      record(name, false, error.message)
      return null
    }
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
  const custIds =
    (await admin.from('customers').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ?? []
  if (custIds.length) {
    await admin.from('customer_phones').delete().in('customer_id', custIds)
    await admin.from('customer_addresses').delete().in('customer_id', custIds)
  }
  await admin.from('customers').delete().eq('restaurant_id', r)
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('notification_outbox').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
}

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)

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
  console.log(`\nSigned in as ${username}. Running M5C scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

  await serviceCleanup(url, serviceKey)

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const allItems = [
    ...(menuRaw?.favorites ?? []),
    ...(menuRaw?.categories ?? []).flatMap((c) => c.items ?? []),
  ]
  const item = allItems[0]
  const item2 = allItems.find((i) => i.id !== item?.id) ?? item
  if (!item) throw new Error('No menu item')

  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')
  if (!cashPm) throw new Error('Need cash payment method')

  const { data: balances0 } = await rpc('get_treasury_balances')
  const drawer = (balances0 ?? []).find((t) => t.is_shift_drawer)
  if (!drawer) throw new Error('No drawer')

  await expectOk('01 open_shift', rpc('open_shift', { p_opening_float: 500 }))
  const { data: balOpen } = await rpc('get_treasury_balances')
  const drawerOpen = (balOpen ?? []).find((t) => t.id === drawer.id)?.balance ?? 0

  const unitPrice = Number(item.base_price)
  const unit2 = Number(item2.base_price)

  // --- Pay now ---
  const paid = await expectOk(
    '02 create pay-now (finalize_sale)',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: unitPrice }],
    }),
  )
  const moneyPaid = paid?.money
  record(
    '02a money paid / remaining 0',
    moneyPaid &&
      near(moneyPaid.order_total, unitPrice) &&
      near(moneyPaid.collected_amount, unitPrice) &&
      near(moneyPaid.remaining_amount, 0) &&
      moneyPaid.payment_status === 'paid',
    JSON.stringify(moneyPaid),
  )

  const { data: balAfterPayNow } = await rpc('get_treasury_balances')
  const drawerAfterPayNow =
    (balAfterPayNow ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  record(
    '02b ledger unchanged until approve',
    near(drawerAfterPayNow, drawerOpen),
    `Δ=${drawerAfterPayNow - drawerOpen}`,
  )

  // --- Pay later ---
  const unpaid = await expectOk(
    '03 create pay-later (create_unpaid_order)',
    rpc('create_unpaid_order', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_order_type: 'takeaway',
    }),
  )
  const moneyUnpaid = unpaid?.money
  record(
    '03a unpaid zero collections',
    moneyUnpaid?.payment_status === 'unpaid' &&
      near(moneyUnpaid?.collected_amount, 0) &&
      near(moneyUnpaid?.remaining_amount, unitPrice),
    JSON.stringify(moneyUnpaid),
  )
  const { data: paysUnpaid } = await admin
    .from('order_payments')
    .select('id')
    .eq('order_id', unpaid.order_id)
  record('03b no collection rows', (paysUnpaid?.length ?? 0) === 0, `${paysUnpaid?.length}`)

  // --- Partial collect on unpaid ---
  const half = Math.round(unitPrice / 2)
  await expectOk(
    '04 partial collect_remaining',
    rpc('collect_remaining', {
      p_order_id: unpaid.order_id,
      p_tenders: [{ payment_method_id: cashPm.id, amount: half }],
    }),
  )
  const { data: detailPartial } = await rpc('get_order_detail', {
    p_order_id: unpaid.order_id,
  })
  record(
    '04a status partial',
    detailPartial?.money?.payment_status === 'partial' &&
      near(detailPartial?.money?.collected_amount, half),
    JSON.stringify(detailPartial?.money),
  )

  // --- Edit pending: increase total, keep old collection, remaining = delta ---
  const editItems = [
    { menu_item_id: item.id, quantity: 1, modifier_option_ids: [] },
    { menu_item_id: item2.id, quantity: 1, modifier_option_ids: [] },
  ]
  const expectedTotal = unitPrice + unit2
  const expectedRemaining = expectedTotal - half

  const edited = await expectOk(
    '05 edit_pending_order add item',
    rpc('edit_pending_order', {
      p_order_id: unpaid.order_id,
      p_items: editItems,
    }),
  )
  record(
    '05a remaining = delta only',
    edited?.money &&
      near(edited.money.order_total, expectedTotal) &&
      near(edited.money.collected_amount, half) &&
      near(edited.money.remaining_amount, expectedRemaining) &&
      edited.money.payment_status === 'partial',
    JSON.stringify(edited?.money),
  )
  record('05b requires_review', edited?.requires_review === true, String(edited?.requires_review))

  const { data: paysAfterEdit } = await admin
    .from('order_payments')
    .select('id, amount, net_amount, collection_status')
    .eq('order_id', unpaid.order_id)
  const pendingRows = (paysAfterEdit ?? []).filter((p) => p.collection_status === 'pending')
  record(
    '05c old collection preserved (1 pending)',
    pendingRows.length === 1 && near(pendingRows[0].net_amount ?? pendingRows[0].amount, half),
    JSON.stringify(pendingRows),
  )

  // Collect remaining only
  await expectOk(
    '06 collect remaining delta',
    rpc('collect_remaining', {
      p_order_id: unpaid.order_id,
      p_tenders: [{ payment_method_id: cashPm.id, amount: expectedRemaining }],
    }),
  )
  const { data: detailPaid } = await rpc('get_order_detail', { p_order_id: unpaid.order_id })
  record(
    '06a now paid (customer axis)',
    detailPaid?.money?.payment_status === 'paid' &&
      near(detailPaid?.money?.remaining_amount, 0),
    JSON.stringify(detailPaid?.money),
  )
  const { data: paysFinal } = await admin
    .from('order_payments')
    .select('id, net_amount, collection_status')
    .eq('order_id', unpaid.order_id)
  record(
    '06b two pending collections (append-only)',
    (paysFinal ?? []).filter((p) => p.collection_status === 'pending').length === 2,
    `${paysFinal?.length} rows`,
  )

  // Timeline human labels
  const timeline = detailPaid?.timeline ?? []
  const labels = timeline.map((e) => e.label || e.payload?.label_ar || e.event_type)
  record(
    '07 timeline has human labels',
    labels.some((l) => String(l).includes('إنشاء') || String(l).includes('تحصيل')) &&
      labels.some((l) => String(l).includes('أُضيف') || String(l).includes('إجمالي')),
    labels.slice(0, 8).join(' | '),
  )

  // Review queue
  const queue = await expectOk(
    '08 list_orders_requiring_review',
    rpc('list_orders_requiring_review', {}),
  )
  record(
    '08a edited order in queue',
    Array.isArray(queue) && queue.some((o) => o.id === unpaid.order_id),
    `count=${queue?.length}`,
  )

  await expectOk(
    '09 clear_order_review',
    rpc('clear_order_review', { p_order_id: unpaid.order_id }),
  )
  const { data: afterClear } = await admin
    .from('orders')
    .select('requires_review')
    .eq('id', unpaid.order_id)
    .single()
  record('09a flag cleared', afterClear?.requires_review === false)

  // Approve then block free edit
  const shiftId = (await rpc('get_pos_context')).data?.open_shift?.id
  if (shiftId) {
    await expectOk(
      '10 approve_pending_for_shift',
      rpc('approve_pending_for_shift', { p_shift_id: shiftId }),
    )
  }

  await expectError(
    '11 free edit blocked after approve',
    rpc('edit_pending_order', {
      p_order_id: unpaid.order_id,
      p_items: editItems,
    }),
    'FREE_EDIT_BLOCKED_AFTER_APPROVE',
  )

  await expectError(
    '12 amend_order requires financial delta path',
    rpc('amend_order', {
      p_order_id: unpaid.order_id,
      p_items: editItems,
      p_reason: 'اختبار',
    }),
    'AMEND_USE_FINANCIAL_DELTA',
  )

  // Ledger only after approve — sale deltas present
  const { data: balFinal } = await rpc('get_treasury_balances')
  const drawerFinal = (balFinal ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const expectedSaleCash = unitPrice + half + expectedRemaining // pay-now full + unpaid partials
  record(
    '13 ledger increased only by approved sales',
    near(drawerFinal - drawerOpen, expectedSaleCash),
    `Δ=${drawerFinal - drawerOpen} expected=${expectedSaleCash}`,
  )

  // Append-only: no UPDATE of net_amount on old payment after edit
  const firstPayId = pendingRows[0]?.id
  if (firstPayId) {
    const { data: firstPay } = await admin
      .from('order_payments')
      .select('net_amount, amount')
      .eq('id', firstPayId)
      .single()
    record(
      '14 original collection amount unchanged',
      near(firstPay?.net_amount ?? firstPay?.amount, half),
      JSON.stringify(firstPay),
    )
  }

  // Notification settings port
  await expectOk(
    '15 upsert_notification_settings',
    rpc('upsert_notification_settings', {
      p_notify_on_order_edit: false,
      p_providers: [
        { type: 'telegram', enabled: false, config: {} },
        { type: 'whatsapp', enabled: false, config: {} },
      ],
    }),
  )
  const settings = await expectOk(
    '15a get_notification_settings',
    rpc('get_notification_settings'),
  )
  record(
    '15b providers array present',
    Array.isArray(settings?.providers) && settings.providers.length >= 2,
    JSON.stringify(settings?.providers),
  )

  await supabase.auth.signOut()
  if (!hasFlag('--no-cleanup')) {
    await serviceCleanup(url, serviceKey)
    console.log('\nCleanup: M5C test data removed.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M5C review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
