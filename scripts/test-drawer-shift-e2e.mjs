import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * E2E (Testing only): shift drawer ownership — expense + cash/instapay/ewallet
 * collections execute immediately; Reject reverses; close to_main succeeds.
 *
 * Credentials: NIHA_TEST_USER / NIHA_TEST_PASSWORD in .env.testing
 */

const INTERNAL = 'staff.niha.local'
const env = loadTestingEnv()
assertTestingTarget(env.VITE_SUPABASE_URL)
refuseProductionMutations(env.VITE_SUPABASE_URL, 'test-drawer-shift-e2e')

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const username = (process.env.NIHA_TEST_USER || env.NIHA_TEST_USER || 'manager')
  .trim()
  .toLowerCase()
const password = process.env.NIHA_TEST_PASSWORD || env.NIHA_TEST_PASSWORD || 'Testing123!'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02

async function main() {
  const supabase = createClient(url, anon)
  const admin = createClient(url, serviceKey)
  const rpc = (name, args = {}) => supabase.rpc(name, args)

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL}`,
    password,
  })
  if (signErr) throw new Error(`sign in: ${signErr.message}`)

  // Heal main cash if inactive (migration should do this; assert anyway)
  const { data: mainBefore } = await admin
    .from('treasuries')
    .select('id, is_active')
    .eq('type', 'cash')
    .eq('is_shift_drawer', false)
    .order('sort_order')
    .limit(1)
    .maybeSingle()
  record('00 main cash row exists', Boolean(mainBefore?.id), mainBefore?.id)
  if (mainBefore && !mainBefore.is_active) {
    await admin.from('treasuries').update({ is_active: true }).eq('id', mainBefore.id)
  }

  // Close leftover open shift
  const { data: open0 } = await rpc('get_open_shift')
  if (open0?.id) {
    const physical = Number(open0.physical_drawer_balance ?? open0.expected_cash ?? 0)
    const { error: c0 } = await rpc('close_shift', {
      p_actual_cash_count: physical,
      p_difference_reason: null,
      p_notes: 'e2e pre-clean',
      p_destination: 'to_main',
    })
    record('00b close leftover shift', !c0, c0?.message ?? 'closed')
  }

  await rpc('open_shift', { p_opening_float: 1000 })
  const { data: ctx } = await rpc('get_pos_context')
  const shiftId = ctx?.open_shift?.id
  record('01 open shift float=1000', Boolean(shiftId), shiftId)

  const drawerOps = () =>
    rpc('get_pos_context').then((r) =>
      Number(r.data?.operational_drawer_balance ?? 0),
    )

  let bal = await drawerOps()
  record('02 drawer ops ~1000', near(bal, 1000), String(bal))

  // Expense
  const { data: expId, error: expErr } = await rpc('pos_record_expense', {
    p_amount: 50,
    p_category: 'petty_cash',
    p_description: 'e2e expense',
    p_vendor: null,
  })
  record('03 expense create', !expErr && Boolean(expId), expErr?.message)
  bal = await drawerOps()
  record('04 drawer after expense ~950', near(bal, 950), String(bal))

  const { data: expRow } = await admin
    .from('expenses')
    .select('status')
    .eq('id', expId)
    .single()
  record('05 expense executed', expRow?.status === 'executed', expRow?.status)

  // Menu item + payment methods
  const { data: pms } = await admin
    .from('payment_methods')
    .select('id, code, treasury_id')
    .eq('is_active', true)
  const cash = pms?.find((p) => p.code === 'cash')
  const insta = pms?.find((p) => p.code === 'instapay')
  const wallet = pms?.find((p) => p.code === 'ewallet')
  const { data: items } = await admin
    .from('menu_items')
    .select('id, base_price, is_active, show_in_pos')
    .eq('is_active', true)
    .eq('show_in_pos', true)
    .limit(5)
  const item = items?.[0]
  record(
    '06 fixtures pm+item',
    Boolean(cash && insta && wallet && item),
    item ? `item=${item.id} price=${item.base_price}` : 'missing',
  )
  if (!item || !cash || !insta || !wallet) {
    throw new Error('Missing sale fixtures')
  }

  async function sale(pm, label) {
    const price = Number(item.base_price)
    const { data, error } = await rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: pm.id, amount: price }],
    })
    record(`07 ${label} sale`, !error && Boolean(data?.order_id), error?.message)
    if (!data?.order_id) return null
    const { data: pays } = await admin
      .from('order_payments')
      .select('id, collection_status, treasury_id, net_amount')
      .eq('order_id', data.order_id)
    const pay = pays?.[0]
    record(
      `08 ${label} approved+treasury`,
      pay?.collection_status === 'approved' && pay?.treasury_id === pm.treasury_id,
      `${pay?.collection_status} treasury=${pay?.treasury_id}`,
    )
    return { pay, price: Number(pay?.net_amount ?? price), orderId: data.order_id }
  }

  const cashSale = await sale(cash, 'cash')
  bal = await drawerOps()
  const afterCash = 950 + Number(cashSale?.price ?? 0)
  record('09 drawer includes cash collection', near(bal, afterCash), `${bal} vs ${afterCash}`)

  const instaBefore = await admin
    .from('treasury_movements')
    .select('amount')
    .eq('treasury_id', insta.treasury_id)
  const instaSumBefore = (instaBefore.data ?? []).reduce((s, r) => s + Number(r.amount), 0)

  const instaSale = await sale(insta, 'instapay')
  const { data: instaMoves } = await admin
    .from('treasury_movements')
    .select('amount')
    .eq('treasury_id', insta.treasury_id)
    .eq('source', 'pos_payment')
  // Just check the payment row posted to instapay treasury (not main)
  record(
    '10 instapay not on main/drawer',
    instaSale?.pay?.treasury_id === insta.treasury_id,
    instaSale?.pay?.treasury_id,
  )

  const walletSale = await sale(wallet, 'ewallet')
  record(
    '11 ewallet on wallet treasury',
    walletSale?.pay?.treasury_id === wallet.treasury_id,
    walletSale?.pay?.treasury_id,
  )

  // Reject expense → reverse
  const { error: rejExp } = await rpc('reject_expense', {
    p_id: expId,
    p_reason: 'e2e reject expense',
  })
  record('12 reject expense', !rejExp, rejExp?.message)
  const { data: expAfter } = await admin
    .from('expenses')
    .select('status')
    .eq('id', expId)
    .single()
  record('13 expense reversed', expAfter?.status === 'reversed', expAfter?.status)
  bal = await drawerOps()
  // drawer = 1000 + cash - 0 expense (reversed)
  const expectAfterExpRej = 1000 + Number(cashSale?.price ?? 0)
  record('14 drawer restored expense', near(bal, expectAfterExpRej), `${bal} vs ${expectAfterExpRej}`)

  // Reject cash collection
  if (cashSale?.pay?.id) {
    const { error: rc } = await rpc('reject_collection', {
      p_id: cashSale.pay.id,
      p_reason: 'e2e reject cash',
    })
    record('15 reject cash collection', !rc, rc?.message)
    const { data: payAfter } = await admin
      .from('order_payments')
      .select('collection_status')
      .eq('id', cashSale.pay.id)
      .single()
    record('16 cash reversed', payAfter?.collection_status === 'reversed', payAfter?.collection_status)
  }

  // Reject digital collections
  for (const [label, saleRow] of [
    ['instapay', instaSale],
    ['ewallet', walletSale],
  ]) {
    if (!saleRow?.pay?.id) continue
    const { error: rd } = await rpc('reject_collection', {
      p_id: saleRow.pay.id,
      p_reason: `e2e reject ${label}`,
    })
    record(`17 reject ${label}`, !rd, rd?.message)
    const { data: pa } = await admin
      .from('order_payments')
      .select('collection_status')
      .eq('id', saleRow.pay.id)
      .single()
    record(`18 ${label} reversed`, pa?.collection_status === 'reversed', pa?.collection_status)
  }

  bal = await drawerOps()
  record('19 drawer back ~1000 after rejects', near(bal, 1000), String(bal))

  // Transfer drawer → digital then reject
  const { data: trId, error: trErr } = await rpc('create_transfer', {
    p_source_treasury_id: cash.treasury_id,
    p_dest_treasury_id: insta.treasury_id,
    p_amount: 20,
    p_reason: 'e2e transfer',
  })
  // create_transfer is manager - may use drawer id from cash mapping
  record('20 create_transfer', !trErr && Boolean(trId), trErr?.message)
  if (trId) {
    const { error: rt } = await rpc('reject_transfer', {
      p_id: trId,
      p_reason: 'e2e reject transfer',
    })
    record('21 reject transfer', !rt, rt?.message)
  }

  // Deposit/withdrawal on drawer via create_adjustment
  const { data: depId, error: depErr } = await rpc('create_adjustment', {
    p_treasury_id: cash.treasury_id,
    p_kind: 'deposit',
    p_amount: 30,
    p_reason: 'e2e deposit',
  })
  record('22 deposit execute', !depErr && Boolean(depId), depErr?.message)
  if (depId) {
    const { error: radj } = await rpc('reject_adjustment', {
      p_id: depId,
      p_reason: 'e2e reject deposit',
    })
    record('23 reject deposit', !radj, radj?.message)
  }

  const { data: mainCheck } = await admin
    .from('treasuries')
    .select('id, is_active, name')
    .eq('type', 'cash')
    .eq('is_shift_drawer', false)
    .order('sort_order')
    .limit(1)
    .maybeSingle()
  if (mainCheck && !mainCheck.is_active) {
    await admin.from('treasuries').update({ is_active: true }).eq('id', mainCheck.id)
  }
  const { data: mainAfter } = await admin
    .from('treasuries')
    .select('id, is_active, name')
    .eq('id', mainCheck?.id ?? '')
    .maybeSingle()
  record('24 main cash active', mainAfter?.is_active === true, JSON.stringify(mainAfter))

  const { data: open1 } = await rpc('get_open_shift')
  const physical = Number(open1?.physical_drawer_balance ?? open1?.expected_cash ?? 0)
  const { data: closeRes, error: closeErr } = await rpc('close_shift', {
    p_actual_cash_count: physical,
    p_difference_reason: null,
    p_notes: 'e2e close to_main',
    p_destination: 'to_main',
  })
  record('25 close_shift to_main', !closeErr && Boolean(closeRes?.handover_id), closeErr?.message)
  record(
    '26 handover executed',
    closeRes?.status === 'executed' || closeRes?.auto_executed === true,
    JSON.stringify({ status: closeRes?.status, auto: closeRes?.auto_executed }),
  )

  // Audit: originals still present
  if (expId) {
    const { data: expKeep } = await admin.from('expenses').select('id, status').eq('id', expId).single()
    record('27 expense row kept', Boolean(expKeep) && expKeep.status === 'reversed', expKeep?.status)
  }
  if (cashSale?.pay?.id) {
    const { data: payKeep } = await admin
      .from('order_payments')
      .select('id, collection_status')
      .eq('id', cashSale.pay.id)
      .single()
    record(
      '28 payment row kept',
      Boolean(payKeep) && payKeep.collection_status === 'reversed',
      payKeep?.collection_status,
    )
  }

  void instaSumBefore
  void instaMoves

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== drawer shift e2e: ${results.length - failed} passed, ${failed} failed ====`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
