import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Focused smoke: money ops execute on create; reject = reverse.
 * Credentials from env: NIHA_TEST_USER / NIHA_TEST_PASSWORD (or defaults).
 */

const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'
const env = loadTestingEnv()
assertTestingTarget(env.VITE_SUPABASE_URL)
refuseProductionMutations(env.VITE_SUPABASE_URL, 'test-unified-execute-reject')

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

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

async function main() {
  const supabase = createClient(url, anon)
  const admin = createClient(url, serviceKey)

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (signErr) throw new Error(`sign in: ${signErr.message}`)

  const rpc = (name, args = {}) => supabase.rpc(name, args)

  // Close leftover open shift if any
  const { data: open } = await rpc('get_open_shift')
  if (open?.id) {
    const physical = Number(open.physical_drawer_balance ?? open.expected_cash ?? 0)
    await rpc('close_shift', {
      p_actual_cash_count: physical,
      p_difference_reason: physical === Number(open.expected_cash) ? null : 'smoke cleanup',
      p_notes: 'unified-execute cleanup',
      p_destination: 'to_main',
    })
  }

  // Clear leftover Path-B / Path-A handovers that block close
  const { data: pendingH } = await rpc('list_pending_handovers')
  for (const h of pendingH ?? []) {
    if (h.status === 'pending') {
      await rpc('reject_shift_handover', {
        p_handover_id: h.id,
        p_reason: 'smoke clear pending handover',
      })
    }
  }

  await rpc('open_shift', { p_opening_float: 500 })
  const { data: ctx } = await rpc('get_pos_context')
  const shiftId = ctx?.open_shift?.id
  record('01 open shift', Boolean(shiftId), `shift=${shiftId}`)

  const balBefore = Number(ctx?.operational_drawer_balance ?? 0)

  const { data: expId, error: expErr } = await rpc('pos_record_expense', {
    p_amount: 25,
    p_category: 'petty_cash',
    p_description: 'smoke auto-execute',
    p_vendor: null,
  })
  record('02 pos_record_expense ok', !expErr && Boolean(expId), expErr?.message)

  const { data: expRow } = await admin
    .from('expenses')
    .select('status, auto_approved')
    .eq('id', expId)
    .single()
  record('03 expense executed', expRow?.status === 'executed' && expRow?.auto_approved === true, expRow?.status)

  const { data: expMoves } = await admin
    .from('treasury_movements')
    .select('id, amount')
    .eq('source_ref_id', expId)
  record('04 expense movement posted', (expMoves ?? []).length >= 1, `n=${expMoves?.length}`)

  const { data: ctx2 } = await rpc('get_pos_context')
  const balAfterExp = Number(ctx2?.operational_drawer_balance ?? 0)
  record(
    '05 ops drawer decreased',
    near(balAfterExp, balBefore - 25),
    `${balBefore} → ${balAfterExp}`,
  )

  const { error: rejErr } = await rpc('reject_expense', {
    p_id: expId,
    p_reason: 'smoke reject=reverse',
  })
  record('06 reject_expense ok', !rejErr, rejErr?.message)

  const { data: expAfter } = await admin
    .from('expenses')
    .select('status')
    .eq('id', expId)
    .single()
  record('07 expense reversed', expAfter?.status === 'reversed', expAfter?.status)

  const { data: ctx3 } = await rpc('get_pos_context')
  const balAfterRej = Number(ctx3?.operational_drawer_balance ?? 0)
  record(
    '08 ops drawer restored',
    near(balAfterRej, balBefore),
    `${balAfterRej} vs ${balBefore}`,
  )

  // Sale → collection auto-approved
  const { data: pms } = await rpc('list_payment_methods')
  const cashPm = (pms ?? []).find((p) => p.code === 'cash' && p.is_active !== false)
  const { data: menuCtx } = await rpc('get_pos_context')
  const item =
    (menuCtx?.menu_categories ?? [])
      .flatMap((c) => c.items ?? [])
      .find((i) => i.is_available !== false && Number(i.price) > 0) ?? null
  if (cashPm && item) {
    const price = Number(item.price)
    const { data: sale, error: saleErr } = await rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifiers: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: price }],
    })
    record('09 finalize_sale ok', !saleErr && Boolean(sale?.order_id), saleErr?.message)
    if (sale?.order_id) {
      const { data: pays } = await admin
        .from('order_payments')
        .select('id, collection_status')
        .eq('order_id', sale.order_id)
      const ok = (pays ?? []).length > 0 && pays.every((p) => p.collection_status === 'approved')
      record('10 collection auto-approved', ok, pays?.map((p) => p.collection_status).join(','))

      const payId = pays?.[0]?.id
      if (payId) {
        const { error: crej } = await rpc('reject_collection', {
          p_id: payId,
          p_reason: 'smoke reject collection',
        })
        record('11 reject_collection(=reverse) ok', !crej, crej?.message)
        const { data: payAfter } = await admin
          .from('order_payments')
          .select('collection_status')
          .eq('id', payId)
          .single()
        record(
          '12 collection reversed',
          payAfter?.collection_status === 'reversed',
          payAfter?.collection_status,
        )
      }
    }
  } else {
    record(
      '09 finalize_sale skipped',
      false,
      `cashPm=${Boolean(cashPm)} item=${Boolean(item)}`,
    )
  }

  // Manager transfer auto-execute
  const { data: bals } = await rpc('get_treasury_balances')
  const drawer = (bals ?? []).find((t) => t.is_shift_drawer)
  const digital = (bals ?? []).find((t) => t.type === 'digital' || t.code === 'instapay')
  if (drawer && digital && Number(drawer.balance) >= 10) {
    const { data: trId, error: trErr } = await rpc('create_transfer', {
      p_source_treasury_id: drawer.id,
      p_dest_treasury_id: digital.id,
      p_amount: 10,
      p_reason: 'smoke transfer',
    })
    record('13 create_transfer ok', !trErr && Boolean(trId), trErr?.message)
    const { data: tr } = await admin
      .from('treasury_transfers')
      .select('status, auto_approved')
      .eq('id', trId)
      .single()
    record('14 transfer executed', tr?.status === 'executed', tr?.status)
    const { error: trRej } = await rpc('reject_transfer', {
      p_id: trId,
      p_reason: 'smoke reject transfer',
    })
    record('15 reject_transfer(=reverse) ok', !trRej, trRej?.message)
  } else {
    record('13 transfer skipped', true, 'insufficient drawer or no digital')
  }

  // Close shift without approve step
  const { data: open2 } = await rpc('get_open_shift')
  const physical = Number(open2?.physical_drawer_balance ?? open2?.expected_cash ?? 0)
  const { error: closeErr } = await rpc('close_shift', {
    p_actual_cash_count: physical,
    p_difference_reason: null,
    p_notes: 'unified-execute done',
    p_destination: 'to_main',
  })
  record('16 close_shift without approve', !closeErr, closeErr?.message)

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== unified execute/reject: ${results.length - failed} passed, ${failed} failed ====`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
