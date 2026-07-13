import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * M5 operational review — split tender treasury routing + no-shift guard.
 *
 * Usage:
 *   pnpm test:m5 -- --username abomalek --password "SECRET" [--no-cleanup]
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

async function countTable(admin, table, filter = () => true) {
  const { data, error } = await admin.from(table).select('*')
  if (error) throw error
  return (data ?? []).filter(filter).length
}

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY in .env.local')
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')

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
    console.error(`\nFAIL: sign in as "${username}": ${signInError.message}`)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running M5 scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

  await serviceCleanup(url, serviceKey, false)

  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const menu = menuRaw ?? {}
  const item =
    menu.favorites?.[0] ??
    menu.categories?.find((c) => c.items?.length)?.items?.[0]
  if (!item) throw new Error('No POS menu item found for test sale.')

  const { data: ctxRaw } = await rpc('get_pos_context')
  const ctx = ctxRaw ?? {}
  const cashPm = (ctx.payment_methods ?? []).find((p) => p.code === 'cash')
  const instaPm = (ctx.payment_methods ?? []).find((p) => p.code === 'instapay')
  if (!cashPm || !instaPm) {
    throw new Error('Expected cash + instapay payment methods.')
  }

  const { data: balancesRaw } = await rpc('get_treasury_balances')
  const drawer = (balancesRaw ?? []).find((t) => t.is_shift_drawer)
  const instapayTreasury = (balancesRaw ?? []).find(
    (t) => t.id === instaPm.treasury_id,
  )
  if (!drawer || !instapayTreasury) {
    throw new Error('Expected drawer + instapay treasury.')
  }

  await expectOk('01 open_shift(float=500)', rpc('open_shift', { p_opening_float: 500 }))
  const bBefore = await rpc('get_treasury_balances')
  const drawerBefore = (bBefore.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const instaBefore =
    (bBefore.data ?? []).find((t) => t.id === instapayTreasury.id)?.balance ?? 0

  const unitPrice = Number(item.base_price)
  const instaPart = Math.min(40, unitPrice)
  const cashPart = unitPrice - instaPart + 10
  const salePayload = {
    p_items: [
      {
        menu_item_id: item.id,
        quantity: 1,
        modifier_option_ids: [],
      },
    ],
    p_tenders: [
      { payment_method_id: instaPm.id, amount: instaPart },
      { payment_method_id: cashPm.id, amount: cashPart },
    ],
    p_discount: null,
    p_order_note: null,
    p_client_request_id: null,
  }

  const saleResult = await expectOk(
    '02 finalize_sale(split tender)',
    rpc('finalize_sale', salePayload),
  )
  if (saleResult) {
    record(
      '02a change on cash only',
      near(saleResult.change, cashPart - (unitPrice - instaPart)),
      `change=${saleResult.change}`,
    )
  }

  const bAfter = await rpc('get_treasury_balances')
  const drawerAfter = (bAfter.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
  const instaAfter =
    (bAfter.data ?? []).find((t) => t.id === instapayTreasury.id)?.balance ?? 0
  const netCash = unitPrice - instaPart
  record(
    '02b ledger unchanged until approve (M5B)',
    near(drawerAfter, drawerBefore),
    `ledger delta=${drawerAfter - drawerBefore}`,
  )
  record(
    '02c instapay ledger unchanged until approve',
    near(instaAfter, instaBefore),
    `ledger delta=${instaAfter - instaBefore}`,
  )

  const { data: ctxAfterSale } = await rpc('get_pos_context')
  const opDrawer = Number(ctxAfterSale?.operational_drawer_balance ?? 0)
  record(
    '02d operational drawer includes pending',
    near(opDrawer, drawerBefore + netCash),
    `op=${opDrawer}`,
  )

  const shiftIdForApprove = ctxAfterSale?.open_shift?.id
  if (shiftIdForApprove) {
    await expectOk(
      '02e approve_pending_for_shift',
      rpc('approve_pending_for_shift', { p_shift_id: shiftIdForApprove }),
    )
    const bApproved = await rpc('get_treasury_balances')
    const drawerApproved =
      (bApproved.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
    const instaApproved =
      (bApproved.data ?? []).find((t) => t.id === instapayTreasury.id)?.balance ?? 0
    record(
      '02f drawer += net cash after approve',
      near(drawerApproved - drawerBefore, netCash),
      `delta=${drawerApproved - drawerBefore}`,
    )
    record(
      '02g instapay += digital after approve',
      near(instaApproved - instaBefore, instaPart),
      `delta=${instaApproved - instaBefore}`,
    )
  }

  if (saleResult) {
    record(
      '02d ORD reference format',
      /^ORD-\d{6}$/.test(String(saleResult.reference)),
      saleResult.reference,
    )
    const { data: pays } = await admin
      .from('order_payments')
      .select('reference, amount, change_given')
      .eq('order_id', saleResult.order_id)
    const allPayRefs = (pays ?? []).every((p) => /^PAY-\d{6}$/.test(String(p.reference)))
    record('02e PAY reference format', allPayRefs, `${pays?.length ?? 0} payments`)
    const { count: ktCount } = await admin
      .from('kitchen_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', saleResult.order_id)
    const { count: pjCount } = await admin
      .from('print_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', saleResult.order_id)
    record('02f print job created', (pjCount ?? 0) >= 1, `print_jobs=${pjCount}`)
    if (item.needs_kitchen) {
      record('02g kitchen ticket when needed', (ktCount ?? 0) === 1, `kitchen=${ktCount}`)
    }
  }

  const allItems = [
    ...(menu.favorites ?? []),
    ...(menu.categories ?? []).flatMap((c) => c.items ?? []),
  ]
  const openItem = allItems.find((i) => i.is_open_price)
  if (openItem) {
    const openPrice = 190
    const b0 = await rpc('get_treasury_balances')
    const d0 = (b0.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
    const openSale = await expectOk(
      '05 open price sale',
      rpc('finalize_sale', {
        p_items: [{ menu_item_id: openItem.id, quantity: 1, modifier_option_ids: [], open_price: openPrice }],
        p_tenders: [{ payment_method_id: cashPm.id, amount: 200 }],
        p_discount: null,
        p_order_note: null,
        p_client_request_id: null,
      }),
    )
    if (openSale) {
      record('05a change = 10', near(openSale.change, 10), `change=${openSale.change}`)
      const b1 = await rpc('get_treasury_balances')
      const d1 = (b1.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
      record('05b ledger unchanged until approve', near(d1, d0), `delta=${d1 - d0}`)
      const { data: ctxOpen } = await rpc('get_pos_context')
      const sid = ctxOpen?.open_shift?.id
      if (sid) {
        await rpc('approve_pending_for_shift', { p_shift_id: sid })
        const b2 = await rpc('get_treasury_balances')
        const d2 = (b2.data ?? []).find((t) => t.id === drawer.id)?.balance ?? 0
        record('05c ledger +190 after approve', near(d2 - d0, openPrice), `delta=${d2 - d0}`)
      }
    }
  } else {
    record('05 open price sale', true, 'skipped — no open price item')
  }

  const modItem = allItems.find(
    (i) => i.accepts_modifiers && i.modifier_groups?.length,
  )
  if (modItem) {
    const g = modItem.modifier_groups[0]
    const optIds = g.options.slice(0, Math.max(g.min_selections, 1)).map((o) => o.id)
    await expectOk(
      '06 modifier sale',
      rpc('finalize_sale', {
        p_items: [{ menu_item_id: modItem.id, quantity: 1, modifier_option_ids: optIds }],
        p_tenders: [{ payment_method_id: cashPm.id, amount: 500 }],
        p_discount: null,
        p_order_note: null,
        p_client_request_id: null,
      }),
    )
  } else {
    record('06 modifier sale', true, 'skipped — no modifier item')
  }

  await expectError(
    '07 digital overpay rejected',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: instaPm.id, amount: unitPrice + 50 }],
      p_discount: null,
      p_order_note: null,
      p_client_request_id: null,
    }),
    'DIGITAL_OVERPAY',
  )

  const discAmt = Math.round(unitPrice * 10) / 100
  const afterDisc = unitPrice - discAmt
  await expectOk(
    '08 manager discount sale',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: afterDisc }],
      p_discount: { type: 'percent', value: 10, reason: 'اختبار خصم' },
      p_order_note: null,
      p_client_request_id: null,
    }),
  )

  const { data: ctxPreClose } = await rpc('get_pos_context')
  if (ctxPreClose?.open_shift?.id) {
    await rpc('approve_pending_for_shift', { p_shift_id: ctxPreClose.open_shift.id })
  }

  const { data: openShift } = await rpc('get_open_shift')
  await expectOk(
    '03 close_shift before guard test',
    rpc('close_shift', {
      p_actual_cash_count: openShift.expected_cash,
      p_difference_reason: null,
      p_notes: 'M5 test',
    }),
  )

  const ordersBefore = await countTable(
    admin,
    'orders',
    (row) => row.restaurant_id === SEED_RESTAURANT_ID,
  )
  const paymentsBefore = await countTable(admin, 'order_payments')
  const ledgerBefore = await countTable(
    admin,
    'treasury_movements',
    (row) =>
      row.restaurant_id === SEED_RESTAURANT_ID && row.source === 'pos_payment',
  )

  await expectError(
    '04 finalize_sale without open shift',
    rpc('finalize_sale', salePayload),
    'NO_OPEN_SHIFT',
  )

  const ordersAfter = await countTable(
    admin,
    'orders',
    (row) => row.restaurant_id === SEED_RESTAURANT_ID,
  )
  const paymentsAfter = await countTable(admin, 'order_payments')
  const ledgerAfter = await countTable(
    admin,
    'treasury_movements',
    (row) =>
      row.restaurant_id === SEED_RESTAURANT_ID && row.source === 'pos_payment',
  )

  record('04a no new orders', ordersAfter === ordersBefore, `${ordersBefore} → ${ordersAfter}`)
  record(
    '04b no new payments',
    paymentsAfter === paymentsBefore,
    `${paymentsBefore} → ${paymentsAfter}`,
  )
  record(
    '04c no new pos ledger movements',
    ledgerAfter === ledgerBefore,
    `${ledgerBefore} → ${ledgerAfter}`,
  )

  await supabase.auth.signOut()

  const cleanup = !hasFlag('--no-cleanup')
  if (cleanup) {
    await serviceCleanup(url, serviceKey, true)
    console.log('\nCleanup: M5 test data removed.')
  } else {
    console.log('\n--no-cleanup: test data kept for inspection.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M5 review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
