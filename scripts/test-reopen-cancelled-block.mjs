/**
 * Testing E2E: cancelled payment hard-block + reopen/append/collect delta.
 */
import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

const INTERNAL = 'staff.niha.local'
const env = loadTestingEnv()
assertTestingTarget(env.VITE_SUPABASE_URL)
refuseProductionMutations(env.VITE_SUPABASE_URL, 'test-reopen-cancelled-block')

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
  console.log('==== reopen + cancelled block e2e (Testing) ====')
  const sb = createClient(url, anon)
  const { error: signErr } = await sb.auth.signInWithPassword({
    email: `${username}@${INTERNAL}`,
    password,
  })
  if (signErr) throw new Error(signErr.message)

  let { data: open } = await sb.rpc('get_open_shift')
  if (!open?.id) {
    await sb.rpc('open_shift', { p_opening_float: 300 })
    ;({ data: open } = await sb.rpc('get_open_shift'))
  }
  record('00 shift', Boolean(open?.id), open?.id)

  const { data: pms } = await sb.from('payment_methods').select('id,code').eq('is_active', true)
  const cash = pms.find((p) => p.code === 'cash')
  const { data: items } = await sb
    .from('menu_items')
    .select('id,base_price')
    .eq('is_active', true)
    .eq('show_in_pos', true)
    .limit(2)
  const itemA = items[0]
  const itemB = items[1] ?? items[0]
  const priceA = Number(itemA.base_price)
  const priceB = Number(itemB.base_price)
  record('01 fixtures', Boolean(cash && itemA), `${priceA}/${priceB}`)

  // --- Cancelled block (cancel first unpaid takeaway after reverse path) ---
  const { data: sale1, error: s1 } = await sb.rpc('finalize_sale', {
    p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  record('02 sale', !s1 && Boolean(sale1?.order_id), s1?.message)
  const oid = sale1.order_id
  const { data: pays } = await sb.from('order_payments').select('id').eq('order_id', oid)
  await sb.rpc('reject_collection', { p_id: pays[0].id, p_reason: 'e2e reverse' })
  await sb.rpc('cancel_order', { p_order_id: oid, p_reason: 'e2e cancel' })

  // Direct insert should be blocked by trigger
  const { error: insErr } = await sb.from('order_payments').insert({
    order_id: oid,
    reference: 'PAY-TEST-BLOCK',
    payment_method_id: cash.id,
    treasury_id: cash.id, // may fail FK - that's ok; we want ORDER_CANCELLED from trigger first
    amount: priceA,
    change_given: 0,
  })
  // If treasury_id wrong, may get FK error — also try collect_remaining
  const { error: cErr } = await sb.rpc('collect_remaining', {
    p_order_id: oid,
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  record(
    '03 collect blocked',
    Boolean(cErr) && /ORDER_CANCELLED/i.test(cErr.message),
    cErr?.message ?? insErr?.message ?? 'allowed',
  )

  // --- Reopen flow ---
  const { data: sale2, error: s2 } = await sb.rpc('finalize_sale', {
    p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  record('04 paid sale', !s2, s2?.message)
  const paidId = sale2.order_id
  const { data: before } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  const collectedBefore = Number(before.money.collected_amount)

  const { error: roErr } = await sb.rpc('reopen_order', {
    p_order_id: paidId,
    p_reason: 'e2e customer wants drink',
  })
  record('05 reopen', !roErr, roErr?.message)

  const { data: mid } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  record('06 requires_review', mid.order.requires_review === true, mid.order.review_reason)

  const { data: app, error: aErr } = await sb.rpc('append_order_items', {
    p_order_id: paidId,
    p_items: [{ menu_item_id: itemB.id, quantity: 1, modifier_option_ids: [] }],
  })
  record('07 append', !aErr, aErr?.message)
  const delta = Number(app?.financial_delta ?? 0)
  record('08 delta > 0', delta > 0, String(delta))

  const { data: afterAppend } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  record(
    '09 prior collection kept',
    Number(afterAppend.money.collected_amount) === collectedBefore,
    `${afterAppend.money.collected_amount} vs ${collectedBefore}`,
  )
  record(
    '10 remaining = delta',
    Math.abs(Number(afterAppend.money.remaining_amount) - delta) < 0.02,
    String(afterAppend.money.remaining_amount),
  )

  const { error: colErr } = await sb.rpc('collect_remaining', {
    p_order_id: paidId,
    p_tenders: [{ payment_method_id: cash.id, amount: delta }],
  })
  record('11 collect delta', !colErr, colErr?.message)

  const { data: final } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  record(
    '12 paid after delta',
    final.order.payment_status === 'paid' || Number(final.money.remaining_amount) < 0.02,
    final.order.payment_status,
  )
  record('13 still in review until clear', final.order.requires_review === true)

  const { error: clearErr } = await sb.rpc('clear_order_review', { p_order_id: paidId })
  record('14 clear review', !clearErr, clearErr?.message)

  console.log(`\n==== result: ${passed} passed, ${failed} failed ====`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
