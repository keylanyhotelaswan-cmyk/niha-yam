/**
 * Full Break Test — Testing only (ADR-0035/0036).
 * Aggressive money / orders / reopen / cancel / reject / invalid input /
 * concurrency / approve-removed scenarios.
 *
 *   pnpm test:full-break
 */
import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'
import { testingStaffCredentials } from './testing-credentials.mjs'

const { username, password, email, env } = testingStaffCredentials()
assertTestingTarget(env.VITE_SUPABASE_URL)
refuseProductionMutations(env.VITE_SUPABASE_URL, 'test-full-break')

const url = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05

let passed = 0
let failed = 0
const failures = []

function record(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    failures.push({ name, detail })
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  console.log('==== FULL BREAK TEST (Testing) ====')
  const sb = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const sb2 = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: signErr } = await sb.auth.signInWithPassword({ email, password })
  if (signErr) throw new Error(`sign-in: ${signErr.message}`)
  record('00 manager login', true, username)

  const { error: sign2 } = await sb2.auth.signInWithPassword({ email, password })
  record('00b second session login', !sign2, sign2?.message)

  // Close leftover / open clean shift
  let { data: open } = await sb.rpc('get_open_shift')
  if (open?.id) {
    const phys = Number(open.physical_drawer_balance ?? open.expected_cash ?? 0)
    await sb.rpc('close_shift', {
      p_actual_cash_count: phys,
      p_difference_reason: phys === Number(open.expected_cash) ? null : 'break-test close',
      p_notes: 'full-break cleanup',
      p_destination: 'to_main',
    })
  }
  const { data: shiftId, error: openErr } = await sb.rpc('open_shift', {
    p_opening_float: 1000,
  })
  record('01 open_shift', !openErr && Boolean(shiftId), openErr?.message)
  ;({ data: open } = await sb.rpc('get_open_shift'))

  const { data: pms } = await sb.from('payment_methods').select('id,code').eq('is_active', true)
  const cash = pms?.find((p) => p.code === 'cash')
  const card = pms?.find((p) => p.code === 'card') || cash
  const { data: items } = await sb
    .from('menu_items')
    .select('id,base_price')
    .eq('is_active', true)
    .eq('show_in_pos', true)
    .limit(3)
  const itemA = items?.[0]
  const itemB = items?.[1] ?? itemA
  const priceA = Number(itemA?.base_price ?? 0)
  const priceB = Number(itemB?.base_price ?? 0)
  record('02 fixtures', Boolean(cash && itemA && priceA > 0), `a=${priceA} b=${priceB}`)

  // --- Invalid inputs ---
  console.log('--- invalid inputs ---')
  {
    const { error } = await sb.rpc('finalize_sale', {
      p_items: [],
      p_tenders: [{ payment_method_id: cash.id, amount: 1 }],
    })
    record('03 empty cart rejected', Boolean(error), error?.message)
  }
  {
    const { error } = await sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 0, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
    })
    record('04 qty 0 rejected', Boolean(error), error?.message)
  }
  {
    const { error } = await sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cash.id, amount: 0 }],
    })
    record('05 zero tender rejected', Boolean(error), error?.message)
  }
  {
    const { error } = await sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: '00000000-0000-0000-0000-000000000000', amount: priceA }],
    })
    record('06 bad payment method rejected', Boolean(error), error?.message)
  }
  {
    const { error } = await sb.rpc('approve_collection', {
      p_id: '00000000-0000-0000-0000-000000000001',
    })
    record(
      '07 approve_collection removed',
      Boolean(error?.message?.includes('APPROVE_REMOVED')),
      error?.message,
    )
  }
  {
    const { error } = await sb.rpc('approve_pending_for_shift', {
      p_shift_id: open.id,
    })
    record(
      '08 approve_pending_for_shift removed',
      Boolean(error?.message?.includes('APPROVE_REMOVED')),
      error?.message,
    )
  }

  // --- Happy sale + reject reverse ---
  console.log('--- sale / reject / reverse ---')
  const { data: sale, error: saleErr } = await sb.rpc('finalize_sale', {
    p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  record('09 finalize_sale', !saleErr && Boolean(sale?.order_id), saleErr?.message)
  const orderId = sale?.order_id

  const { data: pays } = await sb
    .from('order_payments')
    .select('id,collection_status,amount')
    .eq('order_id', orderId)
  record(
    '10 collection auto-approved',
    pays?.[0]?.collection_status === 'approved',
    pays?.[0]?.collection_status,
  )

  const { error: rejErr } = await sb.rpc('reject_collection', {
    p_id: pays[0].id,
    p_reason: 'break-test reverse',
  })
  record('11 reject=reverse', !rejErr, rejErr?.message)
  const { data: pays2 } = await sb
    .from('order_payments')
    .select('collection_status')
    .eq('id', pays[0].id)
    .single()
  record('12 status reversed', pays2?.collection_status === 'reversed', pays2?.collection_status)

  // --- Cancel unpaid / block collect ---
  console.log('--- cancel / block ---')
  let saleU = null
  {
    const res = await sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [],
      p_pay_later: true,
    })
    // p_pay_later may be unsupported — ignore error and fall through
    if (!res.error) saleU = res.data
  }
  // pay_later may not exist — try unpaid path via record without tenders failing
  let unpaidId = saleU?.order_id
  if (!unpaidId) {
    const { data: s2 } = await sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
    })
    unpaidId = s2?.order_id
    const { data: pU } = await sb.from('order_payments').select('id').eq('order_id', unpaidId)
    if (pU?.[0]) {
      await sb.rpc('reject_collection', { p_id: pU[0].id, p_reason: 'prep cancel' })
    }
  }
  const { error: cancelErr } = await sb.rpc('cancel_order', {
    p_order_id: unpaidId,
    p_reason: 'break cancel',
  })
  record('13 cancel_order', !cancelErr, cancelErr?.message)
  const { error: collCancel } = await sb.rpc('collect_remaining', {
    p_order_id: unpaidId,
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  record(
    '14 collect on cancelled blocked',
    Boolean(
      collCancel?.message?.includes('ORDER_CANCELLED') ||
        collCancel?.message?.includes('CANCELLED') ||
        collCancel?.message?.includes('INVALID'),
    ),
    collCancel?.message,
  )

  // --- Reopen / append / delta ---
  console.log('--- reopen / append ---')
  const { data: paid } = await sb.rpc('finalize_sale', {
    p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
    p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
  })
  const paidId = paid?.order_id
  const { data: beforeMoney } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  const collectedBefore = Number(beforeMoney?.money?.collected_amount ?? 0)

  const { error: reopenErr } = await sb.rpc('reopen_order', {
    p_order_id: paidId,
    p_reason: 'break reopen drink',
  })
  record('15 reopen_order', !reopenErr, reopenErr?.message)

  const { data: afterReopen } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  record(
    '16 requires_review',
    afterReopen?.order?.requires_review === true,
    String(afterReopen?.order?.requires_review),
  )

  const { error: appendErr } = await sb.rpc('append_order_items', {
    p_order_id: paidId,
    p_items: [{ menu_item_id: itemB.id, quantity: 1, modifier_option_ids: [] }],
  })
  record('17 append_order_items', !appendErr, appendErr?.message)

  const { data: afterAppend } = await sb.rpc('get_order_detail', { p_order_id: paidId })
  const remaining = Number(afterAppend?.money?.remaining_amount ?? 0)
  const collectedAfterAppend = Number(afterAppend?.money?.collected_amount ?? 0)
  record(
    '18 prior collection preserved',
    near(collectedAfterAppend, collectedBefore),
    `${collectedAfterAppend} vs ${collectedBefore}`,
  )
  record('19 remaining is delta', remaining > 0.01, String(remaining))

  if (remaining > 0.01) {
    const { error: deltaErr } = await sb.rpc('collect_remaining', {
      p_order_id: paidId,
      p_tenders: [{ payment_method_id: cash.id, amount: remaining }],
    })
    record('20 collect delta only', !deltaErr, deltaErr?.message)
  } else {
    record('20 collect delta only', false, 'no remaining')
  }

  // Double reopen should fail
  {
    const { error } = await sb.rpc('reopen_order', {
      p_order_id: paidId,
      p_reason: 'again',
    })
    record(
      '21 double reopen blocked',
      Boolean(error?.message?.includes('ALREADY_IN_REVIEW') || error),
      error?.message,
    )
  }

  // Reopen cancelled blocked
  {
    const { error } = await sb.rpc('reopen_order', {
      p_order_id: unpaidId,
      p_reason: 'no',
    })
    record(
      '22 reopen cancelled blocked',
      Boolean(error?.message?.includes('ORDER_CANCELLED') || error),
      error?.message,
    )
  }

  // --- Concurrent finalize with same client_request_id ---
  console.log('--- concurrency ---')
  const reqId = crypto.randomUUID()
  const [c1, c2] = await Promise.all([
    sb.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
      p_client_request_id: reqId,
    }),
    sb2.rpc('finalize_sale', {
      p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
      p_client_request_id: reqId,
    }),
  ])
  const okCount = [c1, c2].filter((r) => !r.error).length
  const dupReject = [c1, c2].some((r) =>
    String(r.error?.message || '').includes('DUPLICATE'),
  )
  record(
    '23 idempotent client_request_id',
    okCount === 1 && dupReject,
    `ok=${okCount} dup=${dupReject}`,
  )

  // Spam parallel sales (should not crash)
  const spam = await Promise.all(
    Array.from({ length: 8 }, () =>
      sb.rpc('finalize_sale', {
        p_items: [{ menu_item_id: itemA.id, quantity: 1, modifier_option_ids: [] }],
        p_tenders: [{ payment_method_id: cash.id, amount: priceA }],
      }),
    ),
  )
  const spamOk = spam.filter((r) => !r.error).length
  record('24 parallel sales no crash', spamOk >= 6, `ok=${spamOk}/8`)

  // --- Expense execute + reject reverse ---
  console.log('--- expense / transfer ---')
  const { data: drawer } = await sb
    .from('treasuries')
    .select('id')
    .eq('is_shift_drawer', true)
    .limit(1)
    .maybeSingle()
  const { data: expId, error: expErr } = await sb.rpc('create_expense', {
    p_treasury_id: drawer?.id,
    p_category: 'supplies',
    p_amount: 5,
    p_description: 'break expense',
    p_vendor: null,
  })
  record('25 expense executes', !expErr && Boolean(expId), expErr?.message)
  {
    const { error } = await sb.rpc('approve_expense', { p_id: expId })
    record(
      '26 approve_expense removed',
      Boolean(error?.message?.includes('APPROVE_REMOVED')),
      error?.message,
    )
  }
  {
    const { error } = await sb.rpc('reject_expense', {
      p_id: expId,
      p_reason: 'break reverse expense',
    })
    record('27 reject expense = reverse', !error, error?.message)
  }

  // --- list_orders_for_pos smoke ---
  const { data: list, error: listErr } = await sb.rpc('list_orders_for_pos', {
    p_shift_id: open.id,
    p_limit: 20,
  })
  record(
    '28 list_orders_for_pos',
    !listErr && Array.isArray(list) && list.length > 0,
    listErr?.message ?? `n=${list?.length}`,
  )

  // Clear review on reopened order if still flagged
  if (afterAppend?.order?.requires_review) {
    const { error } = await sb.rpc('clear_order_review', { p_order_id: paidId })
    record('29 clear_order_review', !error, error?.message)
  } else {
    record('29 clear_order_review', true, 'already clear or N/A')
  }

  // Close shift
  ;({ data: open } = await sb.rpc('get_open_shift'))
  const phys = Number(open?.physical_drawer_balance ?? open?.expected_cash ?? 0)
  const { error: closeErr } = await sb.rpc('close_shift', {
    p_actual_cash_count: phys,
    p_difference_reason: near(phys, open?.expected_cash) ? null : 'break-test variance ok',
    p_notes: 'full-break close',
    p_destination: 'to_main',
  })
  record('30 close_shift to_main', !closeErr, closeErr?.message)

  console.log('\n==== SUMMARY ====')
  console.log(`passed=${passed} failed=${failed}`)
  if (failures.length) {
    console.log('failures:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`)
  }
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e.message || e)
  process.exit(1)
})

