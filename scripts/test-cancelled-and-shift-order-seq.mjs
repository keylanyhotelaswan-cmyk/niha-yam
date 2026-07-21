/**
 * Testing E2E: cancelled orders block collect; shift order refs reset to 1.
 * Usage: node scripts/test-cancelled-and-shift-order-seq.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

const INTERNAL = 'staff.niha.local'
const env = loadTestingEnv()
assertTestingTarget(env.VITE_SUPABASE_URL)
refuseProductionMutations(env.VITE_SUPABASE_URL, 'test-cancelled-and-shift-order-seq')

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const username = (
  process.env.NIHA_TEST_USER ||
  env.NIHA_TEST_USER ||
  env.TESTING_MANAGER_USERNAME ||
  'manager'
)
  .trim()
  .toLowerCase()
const password =
  process.env.NIHA_TEST_PASSWORD ||
  env.NIHA_TEST_PASSWORD ||
  env.TESTING_MANAGER_PASSWORD ||
  'Testing123!'

let passed = 0
let failed = 0

function record(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  console.log('==== cancelled + shift order seq e2e (Testing) ====')
  const supabase = createClient(url, anon)
  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL}`,
    password,
  })
  if (signErr) throw new Error(`sign in: ${signErr.message}`)

  let { data: openShift } = await supabase.rpc('get_open_shift')
  if (!openShift?.id) {
    const { error } = await supabase.rpc('open_shift', { p_opening_float: 500 })
    record('00 open_shift', !error, error?.message)
    ;({ data: openShift } = await supabase.rpc('get_open_shift'))
  } else {
    record('00 open_shift already', true, openShift.reference)
  }
  const shiftId = openShift?.id
  record('00b shift id', Boolean(shiftId), shiftId)

  const { data: pms } = await supabase
    .from('payment_methods')
    .select('id, code')
    .eq('is_active', true)
  const cash = pms?.find((p) => p.code === 'cash')
  const { data: items } = await supabase
    .from('menu_items')
    .select('id, base_price')
    .eq('is_active', true)
    .eq('show_in_pos', true)
    .limit(1)
  const item = items?.[0]
  record('01 fixtures', Boolean(cash && item), `cash=${cash?.id} item=${item?.id}`)

  const price = Number(item.base_price)

  const { data: sale1, error: e1 } = await supabase.rpc('finalize_sale', {
    p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: price }],
  })
  record('02 sale1', !e1 && Boolean(sale1?.order_id), e1?.message)
  const order1 = sale1?.order_id

  const { data: d1 } = await supabase.rpc('get_order_detail', {
    p_order_id: order1,
  })
  const ref1 = d1?.order?.reference
  record('03 sale1 has reference', Boolean(ref1), String(ref1))
  record('03b sale1 numeric ref', /^\d+$/.test(String(ref1)), String(ref1))

  const { data: payRows } = await supabase
    .from('order_payments')
    .select('id, collection_status')
    .eq('order_id', order1)
  const payId = payRows?.[0]?.id
  record('04 payment exists', Boolean(payId), payId)

  if (payId) {
    const { error: rejErr } = await supabase.rpc('reject_collection', {
      p_id: payId,
      p_reason: 'e2e reverse before cancel',
    })
    record('05 reverse collection', !rejErr, rejErr?.message)
  }

  const { data: afterRev } = await supabase.rpc('get_order_detail', {
    p_order_id: order1,
  })
  record(
    '06 still not cancelled after reverse',
    afterRev?.order?.fulfillment_status !== 'cancelled',
    afterRev?.order?.fulfillment_status,
  )

  const { data: cancelRes, error: cancelErr } = await supabase.rpc('cancel_order', {
    p_order_id: order1,
    p_reason: 'e2e cancel after reverse',
  })
  record('07 cancel_order', !cancelErr, cancelErr?.message ?? JSON.stringify(cancelRes))

  const { data: cancelled } = await supabase.rpc('get_order_detail', {
    p_order_id: order1,
  })
  record(
    '08 fulfillment cancelled',
    cancelled?.order?.fulfillment_status === 'cancelled',
    cancelled?.order?.fulfillment_status,
  )
  record(
    '09 cancel metadata',
    Boolean(cancelled?.order?.cancel_reason) &&
      Boolean(cancelled?.order?.cancelled_at),
    `${cancelled?.order?.cancel_reason} / ${cancelled?.order?.cancelled_by_name}`,
  )

  const { error: collectErr } = await supabase.rpc('collect_remaining', {
    p_order_id: order1,
    p_tenders: [{ payment_method_id: cash.id, amount: price }],
  })
  record(
    '10 collect_remaining blocked',
    Boolean(collectErr) && /ORDER_CANCELLED/i.test(collectErr.message),
    collectErr?.message ?? 'no error (bad)',
  )

  const { error: recErr } = await supabase.rpc('record_collection', {
    p_order_id: order1,
    p_tenders: [{ payment_method_id: cash.id, amount: price }],
  })
  record(
    '11 record_collection blocked',
    Boolean(recErr) && /ORDER_CANCELLED/i.test(recErr.message),
    recErr?.message ?? 'no error (bad)',
  )

  const { data: cancelledList, error: listErr } = await supabase.rpc(
    'list_orders_for_pos',
    {
      p_fulfillment_status: 'cancelled',
      p_hub_only: false,
      p_limit: 50,
    },
  )
  const listed = Array.isArray(cancelledList) ? cancelledList : []
  const found = listed.find((o) => o.id === order1)
  record('12 cancelled list', !listErr && Boolean(found), listErr?.message)
  record(
    '13 list has cancel_reason',
    Boolean(found?.cancel_reason),
    found?.cancel_reason,
  )

  const { data: sale2, error: e2 } = await supabase.rpc('finalize_sale', {
    p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: price }],
  })
  const { data: sale3, error: e3 } = await supabase.rpc('finalize_sale', {
    p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: price }],
  })
  record('14 sale2', !e2, e2?.message)
  record('15 sale3', !e3, e3?.message)

  const { data: d2 } = await supabase.rpc('get_order_detail', {
    p_order_id: sale2?.order_id,
  })
  const { data: d3 } = await supabase.rpc('get_order_detail', {
    p_order_id: sale3?.order_id,
  })
  const r2 = Number(d2?.order?.reference)
  const r3 = Number(d3?.order?.reference)
  record(
    '16 consecutive numeric refs',
    Number.isFinite(r2) && Number.isFinite(r3) && r3 === r2 + 1,
    `${d2?.order?.reference} → ${d3?.order?.reference}`,
  )
  record(
    '17 same shift',
    d2?.order?.shift_id === shiftId && d3?.order?.shift_id === shiftId,
    shiftId,
  )

  console.log(`\n==== result: ${passed} passed, ${failed} failed ====`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
