import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * M5B — collection approval, operational drawer, order timeline.
 *
 * Usage:
 *   pnpm test:m5b -- --username abomalek --password "SECRET" [--no-cleanup]
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
    if (error) return record(name, false, error.message)
    record(name, true)
    return data
  } catch (e) {
    record(name, false, e.message)
    return null
  }
}

async function serviceCleanup(url, serviceKey, log) {
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

  const custIds =
    (await admin.from('customers').select('id').eq('restaurant_id', r)).data?.map(
      (x) => x.id,
    ) ?? []
  if (custIds.length) {
    await admin.from('customer_phones').delete().in('customer_id', custIds)
    await admin.from('customer_addresses').delete().in('customer_id', custIds)
  }
  await admin.from('customers').delete().eq('restaurant_id', r)

  const ktIds =
    (
      await admin.from('kitchen_tickets').select('id').eq('restaurant_id', r)
    ).data?.map((x) => x.id) ?? []
  if (ktIds.length) {
    await admin.from('kitchen_ticket_lines').delete().in('ticket_id', ktIds)
  }
  await admin.from('kitchen_tickets').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  await admin.from('orders').delete().eq('restaurant_id', r)

  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('treasury_adjustments').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  if (log) return
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

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
  console.log(`\nSigned in as ${username}. Running M5B scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

  await serviceCleanup(url, serviceKey, false)

  // Ensure no leftover open shift (cleanup may race with concurrent sessions)
  {
    const { data: leftover } = await rpc('get_open_shift')
    if (leftover?.id) {
      await rpc('approve_pending_for_shift', { p_shift_id: leftover.id })
      await rpc('close_shift', {
        p_actual_cash_count: Number(
          leftover.expected_cash ?? leftover.operational_drawer_balance ?? 0,
        ),
        p_difference_reason: null,
        p_notes: 'm5b reset',
      })
    }
  }

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  if (!item) throw new Error('No menu item for test.')

  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')
  const instaPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'instapay')
  if (!cashPm || !instaPm) throw new Error('Need cash + instapay methods.')

  const { data: balances0 } = await rpc('get_treasury_balances')
  const drawer = (balances0 ?? []).find((t) => t.is_shift_drawer)
  if (!drawer) throw new Error('No drawer treasury.')

  await expectOk('01 open_shift', rpc('open_shift', { p_opening_float: 500 }))

  // Baseline AFTER opening float — float is independent of sale revenue.
  const { data: balAfterOpen } = await rpc('get_treasury_balances')
  const drawerAfterOpen =
    (balAfterOpen ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const instaAfterOpen =
    (balAfterOpen ?? []).find((t) => t.id === instaPm.treasury_id)?.balance ?? 0

  const unitPrice = Number(item.base_price)
  const instaPart = Math.min(40, unitPrice)
  const cashPart = unitPrice - instaPart + 10
  const netCash = unitPrice - instaPart

  const sale = await expectOk(
    '02 finalize_sale → pending',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [
        { payment_method_id: instaPm.id, amount: instaPart },
        { payment_method_id: cashPm.id, amount: cashPart },
      ],
    }),
  )

  const { data: balAfterSale } = await rpc('get_treasury_balances')
  const drawerAfterSale =
    (balAfterSale ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const instaAfterSale =
    (balAfterSale ?? []).find((t) => t.id === instaPm.treasury_id)?.balance ?? 0
  record(
    '03 no sale ledger until approve',
    near(drawerAfterSale - drawerAfterOpen, 0) &&
      near(instaAfterSale - instaAfterOpen, 0),
    `drawer Δ=${drawerAfterSale - drawerAfterOpen} insta Δ=${instaAfterSale - instaAfterOpen}`,
  )

  const { data: ctx1 } = await rpc('get_pos_context')
  const opDrawer = Number(ctx1?.operational_drawer_balance ?? 0)
  // After auto-post, operational drawer = shift ledger (float + posted cash − expenses)
  record(
    '04 operational drawer = shift ledger (cash posted)',
    near(opDrawer, drawerAfterOpen + netCash),
    `op=${opDrawer} expected=${drawerAfterOpen + netCash} (float ${drawerAfterOpen} + cash ${netCash})`,
  )

  // Expense executes immediately and posts ledger
  let expenseAmt = 0
  const expenseAmtTarget = Math.min(10, Math.max(1, Math.floor(netCash / 2) || 1))
  const expId = await expectOk(
    '04b pos_record_expense executed',
    rpc('pos_record_expense', {
      p_amount: expenseAmtTarget,
      p_category: 'petty_cash',
      p_description: 'اختبار مصروف فوري',
      p_vendor: null,
    }),
  )
  if (expId) {
    expenseAmt = expenseAmtTarget
    const { data: expRow } = await admin
      .from('expenses')
      .select('status, amount')
      .eq('id', expId)
      .single()
    record(
      '04c expense executed on create',
      expRow?.status === 'executed',
      expRow?.status,
    )
    const { data: expMoves } = await admin
      .from('treasury_movements')
      .select('id')
      .eq('source_ref_id', expId)
    record(
      '04d treasury movement posted on create',
      (expMoves ?? []).length >= 1,
      `moves=${expMoves?.length ?? 0}`,
    )
    const { data: ctxExp } = await rpc('get_pos_context')
    const opAfterExp = Number(ctxExp?.operational_drawer_balance ?? 0)
    record(
      '04e operational drawer reflects executed expense',
      near(opAfterExp, drawerAfterOpen + netCash - expenseAmt),
      `op=${opAfterExp} expected=${drawerAfterOpen + netCash - expenseAmt}`,
    )
  }

  // Over-spend vs operational should still fail
  {
    const { error: overErr } = await rpc('pos_record_expense', {
      p_amount: 9_999_999,
      p_category: 'petty_cash',
      p_description: 'تجاوز',
      p_vendor: null,
    })
    record(
      '04f oversize expense blocked',
      Boolean(overErr && String(overErr.message).includes('INSUFFICIENT_FUNDS')),
      overErr?.message ?? 'no error',
    )
  }

  if (sale?.order_id) {
    const { data: pays } = await admin
      .from('order_payments')
      .select('collection_status')
      .eq('order_id', sale.order_id)
    const allApproved = (pays ?? []).every((p) => p.collection_status === 'approved')
    record('05 payments approved on create', allApproved, `${pays?.length ?? 0} rows`)

    const { data: order } = await admin
      .from('orders')
      .select('payment_status')
      .eq('id', sale.order_id)
      .single()
    record(
      '06 order paid after auto-posted collections',
      order?.payment_status === 'paid',
      order?.payment_status,
    )

    const timeline = await expectOk(
      '07 order timeline',
      rpc('get_order_timeline', { p_order_id: sale.order_id }),
    )
    const types = (timeline ?? []).map((e) => e.event_type)
    record(
      '07a timeline has created + collection',
      types.includes('order.created') &&
        (types.includes('collection.recorded') || types.includes('collection.approved')),
      types.join(', '),
    )
  }

  const shiftId = ctx1?.open_shift?.id
  if (shiftId) {
    const report = await expectOk(
      '08 shift report KPIs',
      rpc('get_shift_report', { p_shift_id: shiftId }),
    )
    record(
      '08a pending count == 0 (auto-execute)',
      Number(report?.pending_collections_count ?? 0) === 0,
      `count=${report?.pending_collections_count}`,
    )

    const approved = await expectOk(
      '09 approve_pending_for_shift residual',
      rpc('approve_pending_for_shift', { p_shift_id: shiftId }),
    )
    record(
      '09a bulk approved collections residual',
      Number(approved?.approved_count ?? 0) === 0,
      `approved=${approved?.approved_count}`,
    )
    record(
      '09b bulk approved expenses residual',
      Number(approved?.approved_expenses_count ?? 0) === 0,
      `expenses=${approved?.approved_expenses_count}`,
    )
    if (expId) {
      const { data: expDone } = await admin
        .from('expenses')
        .select('status')
        .eq('id', expId)
        .single()
      record(
        '09c expense still executed',
        expDone?.status === 'executed',
        expDone?.status,
      )
    }
  }

  const { data: balFinal } = await rpc('get_treasury_balances')
  const drawerFinal =
    (balFinal ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const instaFinal =
    (balFinal ?? []).find((t) => t.id === instaPm.treasury_id)?.balance ?? 0
  record(
    '10 sale ledger after approve (delta only)',
    near(drawerFinal - drawerAfterOpen, netCash - expenseAmt) &&
      near(instaFinal - instaAfterOpen, instaPart),
    `drawer Δ=${drawerFinal - drawerAfterOpen} expected=${netCash - expenseAmt}; insta Δ=${instaFinal - instaAfterOpen} expected=${instaPart}`,
  )

  if (sale?.order_id) {
    const { data: order2 } = await admin
      .from('orders')
      .select('payment_status')
      .eq('id', sale.order_id)
      .single()
    record('11 order paid after approve', order2?.payment_status === 'paid', order2?.payment_status)
  }

  const phone = '01001234567'
  const delivery = await expectOk(
    '12 create_delivery_order unpaid',
    rpc('create_delivery_order', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_customer_phone: phone,
      p_customer_name: 'اختبار توصيل',
      p_delivery_address: 'شارع الاختبار 1',
    }),
  )
  if (delivery?.order_id) {
    await expectOk(
      '13 fulfillment while unpaid',
      rpc('update_fulfillment_status', {
        p_order_id: delivery.order_id,
        p_status: 'preparing',
      }),
    )
  }

  await expectOk(
    '14 lookup_customer_by_phone',
    rpc('lookup_customer_by_phone', { p_phone: phone }),
  )

  const list = await expectOk('15 list_orders_for_pos', rpc('list_orders_for_pos', {}))
  record('15a orders listed', Array.isArray(list) && list.length >= 2, `count=${list?.length}`)

  await supabase.auth.signOut()

  const cleanup = !hasFlag('--no-cleanup')
  if (cleanup) {
    await serviceCleanup(url, serviceKey, true)
    console.log('\nCleanup: M5B test data removed.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M5B review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
