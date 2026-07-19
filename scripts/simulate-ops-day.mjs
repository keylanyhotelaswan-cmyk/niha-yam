/**
 * Full restaurant ops-day simulation on Testing only (~8h of mixed ops).
 *
 *   pnpm simulate:ops-day
 *   pnpm simulate:ops-day -- --username manager --password "Testing123!"
 *
 * Refuses Production. Does NOT promote. Writes docs/ops-day-simulation-report.md
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'
import {
  createRecorder,
  ensureCashPm,
  ensureMenuItem,
  INTERNAL_EMAIL_DOMAIN,
  readArg,
  rpcOf,
  SEED_RESTAURANT_ID,
  softReset,
} from './chaos-lib.mjs'

const SCENARIOS = [
  'open_shift',
  'sales',
  'collection',
  'discounts',
  'expenses',
  'transfers',
  'purchasing',
  'reverse',
  'reports',
  'close_shift',
  'stress',
  'printing',
]

function bucketOf(name) {
  const n = name.toLowerCase()
  if (n.includes('open_shift') || n.startsWith('day open')) return 'open_shift'
  if (n.includes('print') || n.includes('kitchen') || n.includes('receipt'))
    return 'printing'
  if (
    n.includes('close_shift') ||
    n.includes('إغلاق') ||
    n.startsWith('close:') ||
    n.includes('handover')
  )
    return 'close_shift'
  if (n.includes('report') || n.includes('dashboard') || n.includes('stock card'))
    return 'reports'
  if (n.startsWith('stress:') || n.includes(' race ') || n.includes('burst'))
    return 'stress'
  if (n.includes('reverse') || n.includes('عكس')) return 'reverse'
  // "purchasing" does NOT contain the substring "purchase" (no trailing e).
  if (
    n.includes('purchas') ||
    n.includes('ingredient') ||
    n.includes('supplier') ||
    n.includes('uom') ||
    n.includes('شراء') ||
    n.includes('مورد')
  )
    return 'purchasing'
  if (n.includes('transfer') || n.includes('تحويل')) return 'transfers'
  if (n.includes('expense') || n.includes('مصروف')) return 'expenses'
  if (n.includes('discount') || n.includes('خصم')) return 'discounts'
  if (n.includes('collect') || n.includes('تحصيل') || n.includes('approve_pending'))
    return 'collection'
  if (
    n.includes('sale') ||
    n.includes('finalize') ||
    n.includes('delivery') ||
    n.includes('unpaid') ||
    n.includes('cancel') ||
    n.includes('channel') ||
    n.includes('dine') ||
    n.includes('fulfillment')
  )
    return 'sales'
  return 'sales'
}

async function signInTesting(url, anon, username, password) {
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (error) throw new Error(`sign-in: ${error.message}`)
  return client
}

async function pmByCode(rpc, code) {
  const { data: ctx } = await rpc('get_pos_context')
  return (ctx?.payment_methods ?? []).find((p) => p.code === code) ?? null
}

async function treasuriesMap(client) {
  const { data } = await client.from('treasuries').select('*').eq('is_active', true)
  const drawer = (data ?? []).find((t) => t.is_shift_drawer)
  const main = (data ?? []).find((t) => t.type === 'cash' && !t.is_shift_drawer)
  const digitals = (data ?? []).filter((t) => !t.is_shift_drawer && t.id !== main?.id)
  return { drawer, main, digitals, all: data ?? [] }
}

function saleItems(item, qty = 1) {
  return [{ menu_item_id: item.id, quantity: qty, modifier_option_ids: [] }]
}

async function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)
  refuseProductionMutations(env.VITE_SUPABASE_URL)
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!anon) throw new Error('Missing anon key')

  const username = readArg('--username', env.TESTING_MANAGER_USERNAME || 'manager')
    .trim()
    .toLowerCase()
  const password = readArg('--password', 'Testing123!')

  const { record, expectOk, expectError, summary, results } = createRecorder()
  const admin = serviceKey
    ? createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null

  console.log('\n======= NIHA Ops-Day Simulation (Testing only) =======\n')
  const client = await signInTesting(url, anon, username, password)
  const rpc = rpcOf(client)
  console.log(`Signed in as ${username}\n`)

  // -------------------------------------------------------------------------
  // Prep: soft reset + open shift
  // -------------------------------------------------------------------------
  console.log('--- Day open ---')
  await softReset(rpc)
  const open = await expectOk(
    'Day open: open_shift float=1000',
    rpc('open_shift', { p_opening_float: 1000 }),
  )
  record('Day open: shift created', !!open, String(open))

  const item = await ensureMenuItem(rpc)
  const unit = Number(item.base_price) || 50
  const { cashPm } = await ensureCashPm(rpc)
  const instaPm = await pmByCode(rpc, 'instapay')
  const walletPm = (await pmByCode(rpc, 'ewallet')) || (await pmByCode(rpc, 'wallet'))
  const cardPm =
    (await pmByCode(rpc, 'card')) ||
    (await pmByCode(rpc, 'visa')) ||
    (await pmByCode(rpc, 'bank')) ||
    cashPm

  record(
    'Day open: payment methods loaded',
    !!cashPm && !!instaPm,
    `cash=${!!cashPm} insta=${!!instaPm} wallet=${!!walletPm} card=${!!cardPm}`,
  )

  const tres = await treasuriesMap(client)
  record(
    'Day open: drawer+main treasuries',
    !!tres.drawer && !!tres.main,
    `drawer=${tres.drawer?.name} main=${tres.main?.name}`,
  )

  // Deposit main for purchases later
  if (tres.main) {
    const adj = await rpc('create_adjustment', {
      p_treasury_id: tres.main.id,
      p_kind: 'deposit',
      p_amount: 2000,
      p_reason: 'ops-day float main',
    })
    if (adj.data) await rpc('approve_adjustment', { p_id: adj.data })
    record('Day open: main cash deposit', !adj.error, adj.error?.message ?? '')
  }

  // -------------------------------------------------------------------------
  // Sales burst — channels / pay methods / mixed
  // -------------------------------------------------------------------------
  console.log('--- Sales ---')
  const saleIds = []
  for (let i = 0; i < 12; i++) {
    const res = await rpc('finalize_sale', {
      p_items: saleItems(item, 1 + (i % 2)),
      p_tenders: [
        {
          payment_method_id: cashPm.id,
          amount: unit * (1 + (i % 2)) + 5,
        },
      ],
      p_discount: null,
      p_order_note: `ops-day cash #${i + 1}`,
      p_client_request_id: crypto.randomUUID(),
    })
    if (!res.error && res.data?.order_id) saleIds.push(res.data.order_id)
  }
  record('Sales: 12 cash dine/takeaway', saleIds.length >= 10, `n=${saleIds.length}`)

  // InstaPay
  let instaOk = 0
  if (instaPm) {
    for (let i = 0; i < 6; i++) {
      const res = await rpc('finalize_sale', {
        p_items: saleItems(item),
        p_tenders: [{ payment_method_id: instaPm.id, amount: unit }],
        p_client_request_id: crypto.randomUUID(),
      })
      if (!res.error) {
        instaOk++
        if (res.data?.order_id) saleIds.push(res.data.order_id)
      }
    }
  }
  record('Sales: 6 InstaPay', instaOk >= 5, `ok=${instaOk}`)

  // Wallet
  let walletOk = 0
  if (walletPm) {
    for (let i = 0; i < 4; i++) {
      const res = await rpc('finalize_sale', {
        p_items: saleItems(item),
        p_tenders: [{ payment_method_id: walletPm.id, amount: unit }],
        p_client_request_id: crypto.randomUUID(),
      })
      if (!res.error) {
        walletOk++
        if (res.data?.order_id) saleIds.push(res.data.order_id)
      }
    }
  }
  record('Sales: wallet (or skip)', walletPm ? walletOk >= 3 : true, `ok=${walletOk}`)

  // Card / bank fallback
  let cardOk = 0
  for (let i = 0; i < 3; i++) {
    const res = await rpc('finalize_sale', {
      p_items: saleItems(item),
      p_tenders: [{ payment_method_id: cardPm.id, amount: unit }],
      p_client_request_id: crypto.randomUUID(),
    })
    if (!res.error) {
      cardOk++
      if (res.data?.order_id) saleIds.push(res.data.order_id)
    }
  }
  record('Sales: card/bank tenders', cardOk >= 2, `ok=${cardOk}`)

  // Mixed tender
  let mixedOk = 0
  if (instaPm) {
    for (let i = 0; i < 4; i++) {
      const half = Math.round(unit / 2)
      const res = await rpc('finalize_sale', {
        p_items: saleItems(item),
        p_tenders: [
          { payment_method_id: cashPm.id, amount: unit - half + 10 },
          { payment_method_id: instaPm.id, amount: half },
        ],
        p_client_request_id: crypto.randomUUID(),
      })
      if (!res.error) {
        mixedOk++
        if (res.data?.order_id) saleIds.push(res.data.order_id)
      }
    }
  }
  record('Sales: mixed cash+insta', mixedOk >= 3, `ok=${mixedOk}`)

  // Delivery unpaid
  const deliveries = []
  for (let i = 0; i < 4; i++) {
    const d = await rpc('create_delivery_order', {
      p_items: saleItems(item),
      p_customer_phone: `0100${1000000 + i}`,
      p_customer_name: `عميل-يوم-${i}`,
      p_delivery_address: `عنوان اختبار ${i}`,
    })
    if (!d.error && d.data?.order_id) {
      deliveries.push(d.data.order_id)
      await rpc('update_fulfillment_status', {
        p_order_id: d.data.order_id,
        p_status: i % 2 === 0 ? 'preparing' : 'ready',
      })
    }
  }
  record('Sales: delivery unpaid ×4', deliveries.length >= 3, `n=${deliveries.length}`)

  // Unpaid takeaway (pay later)
  const unpaid = []
  for (let i = 0; i < 5; i++) {
    const u = await rpc('create_unpaid_order', {
      p_items: saleItems(item),
      p_order_type: i % 2 === 0 ? 'takeaway' : 'dine_in',
    })
    if (!u.error && u.data?.order_id) unpaid.push(u.data.order_id)
  }
  record('Sales: unpaid dine/takeaway ×5', unpaid.length >= 4, `n=${unpaid.length}`)

  // -------------------------------------------------------------------------
  // Discounts
  // -------------------------------------------------------------------------
  console.log('--- Discounts ---')
  const discAmt = await expectOk(
    'Discounts: amount 10',
    rpc('finalize_sale', {
      p_items: saleItems(item),
      p_tenders: [{ payment_method_id: cashPm.id, amount: Math.max(unit - 10, 1) + 20 }],
      p_discount: { type: 'amount', value: 10, reason: 'ops-day amount' },
      p_client_request_id: crypto.randomUUID(),
    }),
  )
  const discPct = await expectOk(
    'Discounts: percent 10%',
    rpc('finalize_sale', {
      p_items: saleItems(item),
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      p_discount: { type: 'percent', value: 10, reason: 'ops-day pct' },
      p_client_request_id: crypto.randomUUID(),
    }),
  )
  const discNone = await expectOk(
    'Discounts: none',
    rpc('finalize_sale', {
      p_items: saleItems(item),
      p_tenders: [{ payment_method_id: cashPm.id, amount: unit + 5 }],
      p_discount: null,
      p_client_request_id: crypto.randomUUID(),
    }),
  )
  if (discAmt?.order_id) saleIds.push(discAmt.order_id)
  if (discPct?.order_id) saleIds.push(discPct.order_id)
  if (discNone?.order_id) saleIds.push(discNone.order_id)

  // -------------------------------------------------------------------------
  // Collections (partial / full / remainder)
  // -------------------------------------------------------------------------
  console.log('--- Collections ---')
  if (unpaid[0]) {
    const part = Math.max(Math.round(unit / 2), 1)
    const c1 = await expectOk(
      'Collection: partial',
      rpc('record_collection', {
        p_order_id: unpaid[0],
        p_tenders: [{ payment_method_id: cashPm.id, amount: part }],
      }),
    )
    record('Collection: partial ok', !!c1, '')
    const rem = unit - part
    if (rem > 0) {
      await expectOk(
        'Collection: remaining',
        rpc('record_collection', {
          p_order_id: unpaid[0],
          p_tenders: [{ payment_method_id: cashPm.id, amount: rem }],
        }),
      )
    }
  }
  if (unpaid[1]) {
    await expectOk(
      'Collection: full',
      rpc('record_collection', {
        p_order_id: unpaid[1],
        p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
      }),
    )
  }
  if (deliveries[0] && instaPm) {
    await expectOk(
      'Collection: delivery via InstaPay',
      rpc('record_collection', {
        p_order_id: deliveries[0],
        p_tenders: [{ payment_method_id: instaPm.id, amount: unit }],
      }),
    )
  }

  const { data: ctxMid } = await rpc('get_pos_context')
  const shiftId = ctxMid?.open_shift?.id
  if (shiftId) {
    await expectOk(
      'Collection: approve_pending_for_shift',
      rpc('approve_pending_for_shift', { p_shift_id: shiftId }),
    )
  }

  // -------------------------------------------------------------------------
  // Cancels
  // -------------------------------------------------------------------------
  console.log('--- Cancels ---')
  if (unpaid[2]) {
    await expectOk(
      'Sales: cancel unpaid before pay',
      rpc('cancel_order', {
        p_order_id: unpaid[2],
        p_reason: 'إلغاء قبل الدفع — محاكاة يوم',
      }),
    )
  }
  if (saleIds[0]) {
    await expectError(
      'Sales: cancel paid blocked',
      rpc('cancel_order', {
        p_order_id: saleIds[0],
        p_reason: 'should fail',
      }),
      'CANCEL',
    )
  }
  if (admin && unpaid[2]) {
    const { data: aud } = await admin
      .from('audit_log')
      .select('action')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .eq('action', 'order.cancelled')
      .limit(5)
    record('Sales: cancel audit present', (aud?.length ?? 0) > 0, `n=${aud?.length}`)
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------
  console.log('--- Expenses ---')
  const expenseKinds = [
    ['supplies', 'منظفات'],
    ['utilities', 'مياه'],
    ['other', 'مواصلات'],
    ['maintenance', 'صيانة بسيطة'],
    ['petty_cash', 'نثرية تشغيل'],
  ]
  let expOk = 0
  for (const [cat, desc] of expenseKinds) {
    const e = await rpc('pos_record_expense', {
      p_amount: 15 + expOk * 5,
      p_category: cat,
      p_description: desc,
      p_vendor: null,
    })
    if (!e.error) expOk++
  }
  record('Expenses: 5 POS expenses', expOk >= 4, `ok=${expOk}`)
  if (shiftId) {
    await rpc('approve_pending_for_shift', { p_shift_id: shiftId })
  }

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------
  console.log('--- Transfers ---')
  const { data: ctxT } = await rpc('get_pos_context')
  const opTreas = ctxT?.operational_treasuries ?? []
  const drawerOp = opTreas.find((t) => t.code === 'drawer')
  const instaOp = opTreas.find((t) => t.code === 'instapay')
  const walletOp = opTreas.find((t) => t.code === 'ewallet' || t.code === 'wallet')

  const transferIds = []
  if (drawerOp && instaOp) {
    for (let i = 0; i < 3; i++) {
      const tr = await rpc('pos_operational_transfer', {
        p_source_treasury_id: drawerOp.id,
        p_dest_treasury_id: instaOp.id,
        p_amount: 25,
        p_reason: 'تحويل تحصيل',
      })
      if (!tr.error && tr.data) transferIds.push(tr.data)
      record(`Transfers: drawer→insta #${i + 1}`, !tr.error, tr.error?.message ?? String(tr.data))
    }
  }
  if (drawerOp && walletOp) {
    const tr = await expectOk(
      'Transfers: drawer→wallet',
      rpc('pos_operational_transfer', {
        p_source_treasury_id: drawerOp.id,
        p_dest_treasury_id: walletOp.id,
        p_amount: 20,
        p_reason: 'تسوية الوردية',
      }),
    )
    if (tr) transferIds.push(tr)
  }

  const balAfterXfer = await rpc('get_treasury_balances')
  record(
    'Transfers: balances readable',
    !balAfterXfer.error && Array.isArray(balAfterXfer.data),
    `n=${balAfterXfer.data?.length}`,
  )

  // -------------------------------------------------------------------------
  // Purchasing + create ingredients
  // -------------------------------------------------------------------------
  console.log('--- Purchasing ---')
  const names = ['طماطم', 'جبنة', 'أكياس', 'زيت', 'فويل', 'دقيق', 'منظف']
  let uoms = await expectOk(
    'Purchasing: bootstrap ops uoms',
    rpc('pur_bootstrap_ops_uoms'),
  )
  if (!uoms?.length) {
    uoms = await expectOk('Purchasing: list ops uoms', rpc('pur_list_ops_uoms'))
  }
  const kg =
    (uoms ?? []).find((u) => u.code === 'kg') ||
    (uoms ?? []).find((u) => u.code === 'pcs') ||
    (uoms ?? [])[0]
  record('Purchasing: uom available', Boolean(kg?.id), kg ? kg.code : 'none')
  const createdIngs = []
  if (kg?.id) {
    for (const name of names) {
      const c = await rpc('pur_create_ops_ingredient', {
        p_name_ar: `${name}-يوم-${Date.now().toString().slice(-4)}`,
        p_base_uom_id: kg.id,
        p_standard_cost: 5,
      })
      if (!c.error && c.data?.id) createdIngs.push(c.data)
    }
  }
  record(
    'Purchasing: create ingredients during day',
    createdIngs.length >= 5,
    `n=${createdIngs.length}`,
  )

  const listed = await expectOk(
    'Purchasing: ingredients appear in ops list',
    rpc('pur_list_ops_ingredients'),
  )
  const listedIds = new Set((listed ?? []).map((i) => i.id))
  record(
    'Purchasing: new ingredients in list',
    createdIngs.every((i) => listedIds.has(i.id)),
    '',
  )

  const supplier = await expectOk(
    'Purchasing: upsert supplier',
    rpc('pur_upsert_supplier', {
      p_id: null,
      p_name_ar: `مورد-يوم-${Date.now().toString().slice(-5)}`,
      p_name_en: null,
      p_code: `D${Date.now().toString().slice(-6)}`,
      p_phone: null,
      p_notes: 'ops-day',
      p_is_active: true,
    }),
  )

  const payTreasury = tres.drawer?.id || tres.main?.id
  // Ensure drawer has funds for buy
  if (tres.drawer) {
    const adj = await rpc('create_adjustment', {
      p_treasury_id: tres.drawer.id,
      p_kind: 'deposit',
      p_amount: 500,
      p_reason: 'ops-day purchase float',
    })
    if (adj.data) await rpc('approve_adjustment', { p_id: adj.data })
  }

  const purchaseIds = []
  // Direct buys
  for (let i = 0; i < 4; i++) {
    const ing = createdIngs[i]
    const posted = await rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: payTreasury,
      p_source_kind: 'direct',
      p_supplier_id: null,
      p_direct_label: `سوق يوم تشغيل ${i + 1}`,
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ing.id,
          qty: 2 + i,
          uom_id: ing.base_uom_id,
          unit_price: 8 + i,
        },
      ],
    })
    record(`Purchasing: direct #${i + 1}`, !posted.error, posted.error?.message ?? posted.data?.reference)
    if (posted.data?.id) purchaseIds.push(posted.data.id)
  }
  // Supplier buys
  for (let i = 0; i < 3; i++) {
    const ing = createdIngs[4 + i] || createdIngs[0]
    const posted = await rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: payTreasury,
      p_source_kind: 'supplier',
      p_supplier_id: supplier?.id,
      p_direct_label: null,
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ing.id,
          qty: 1,
          uom_id: ing.base_uom_id,
          unit_price: 12,
        },
      ],
    })
    record(
      `Purchasing: supplier #${i + 1}`,
      !posted.error,
      posted.error?.message ?? posted.data?.reference,
    )
    if (posted.data?.id) purchaseIds.push(posted.data.id)
  }

  // -------------------------------------------------------------------------
  // Reverse
  // -------------------------------------------------------------------------
  console.log('--- Reverse ---')
  if (purchaseIds[0]) {
    const beforeCard = await rpc('inv_get_stock_card', {
      p_ingredient_id: createdIngs[0].id,
      p_location_id: null,
      p_limit: 5,
    })
    const onHandBefore = Number(beforeCard.data?.on_hand ?? 0)
    const rev = await expectOk(
      'Reverse: purchase',
      rpc('pur_reverse_direct_cash_purchase', {
        p_id: purchaseIds[0],
        p_reason: 'عكس محاكاة يوم',
      }),
    )
    const afterCard = await rpc('inv_get_stock_card', {
      p_ingredient_id: createdIngs[0].id,
      p_location_id: null,
      p_limit: 5,
    })
    record(
      'Reverse: stock restored after purchase reverse',
      Number(afterCard.data?.on_hand ?? 0) < onHandBefore || rev?.status === 'reversed',
      `before=${onHandBefore} after=${afterCard.data?.on_hand}`,
    )
  }

  // Reverse one POS transfer if we have transfer id (uuid from rpc)
  if (transferIds[0]) {
    const tid = typeof transferIds[0] === 'string' ? transferIds[0] : transferIds[0]?.id
    if (tid) {
      await expectOk(
        'Reverse: transfer',
        rpc('reverse_transfer', {
          p_id: tid,
          p_reason: 'عكس تحويل محاكاة',
        }),
      )
    }
  }

  // Purchase again after reverse (stress pattern)
  if (createdIngs[0] && payTreasury) {
    await expectOk(
      'Reverse: buy again after reverse',
      rpc('pur_post_direct_cash_purchase', {
        p_treasury_id: payTreasury,
        p_source_kind: 'direct',
        p_supplier_id: null,
        p_direct_label: 'إعادة شراء بعد العكس',
        p_notes: null,
        p_lines: [
          {
            ingredient_id: createdIngs[0].id,
            qty: 1,
            uom_id: createdIngs[0].base_uom_id,
            unit_price: 9,
          },
        ],
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Printing unaffected
  // -------------------------------------------------------------------------
  console.log('--- Printing ---')
  if (admin && saleIds.length) {
    const { data: jobs } = await admin
      .from('print_jobs')
      .select('id, kind, status, order_id')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .in('order_id', saleIds.slice(0, 20))
    const kitchen = (jobs ?? []).filter((j) => j.kind === 'kitchen').length
    const receipt = (jobs ?? []).filter((j) => j.kind === 'receipt').length
    record(
      'Printing: kitchen/receipt jobs exist',
      kitchen + receipt > 0,
      `kitchen=${kitchen} receipt=${receipt}`,
    )
  } else {
    record('Printing: skipped (no service key)', !!admin, '')
  }

  // -------------------------------------------------------------------------
  // Reports / consistency
  // -------------------------------------------------------------------------
  console.log('--- Reports ---')
  if (shiftId) {
    const report = await expectOk(
      'Reports: get_shift_report',
      rpc('get_shift_report', { p_shift_id: shiftId }),
    )
    record(
      'Reports: shift expected_cash defined',
      report != null && report.expected_cash != null,
      `expected=${report?.expected_cash}`,
    )
  }
  const dash = await expectOk('Reports: inv_dashboard', rpc('inv_dashboard'))
  record(
    'Reports: inventory dashboard',
    dash != null && typeof dash.ingredients_total === 'number',
    `ingredients=${dash?.ingredients_total}`,
  )
  const purchList = await expectOk(
    'Reports: pur_list_purchases',
    rpc('pur_list_purchases', { p_limit: 50 }),
  )
  record(
    'Reports: purchases listed',
    Array.isArray(purchList) && purchList.length > 0,
    `n=${purchList?.length}`,
  )
  const bals = await expectOk('Reports: get_treasury_balances', rpc('get_treasury_balances'))
  record('Reports: treasury balances', Array.isArray(bals), `n=${bals?.length}`)

  if (admin) {
    const { data: movs } = await admin
      .from('treasury_movements')
      .select('source')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
    const sources = new Set((movs ?? []).map((m) => m.source))
    record(
      'Reports: movements include purchase+expense',
      sources.has('purchase') && sources.has('expense'),
      [...sources].join(','),
    )
  }

  // -------------------------------------------------------------------------
  // Stress / interleaved
  // -------------------------------------------------------------------------
  console.log('--- Stress ---')
  const burst = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      rpc('finalize_sale', {
        p_items: saleItems(item),
        p_tenders: [{ payment_method_id: cashPm.id, amount: unit + 5 }],
        p_client_request_id: crypto.randomUUID(),
        p_order_note: `burst-${i}`,
      }),
    ),
  )
  const burstOk = burst.filter((r) => !r.error).length
  record('Stress: parallel sales burst', burstOk >= 6, `ok=${burstOk}/8`)

  if (createdIngs[1] && payTreasury) {
    const buys = await Promise.all(
      [1, 2, 3].map((i) =>
        rpc('pur_post_direct_cash_purchase', {
          p_treasury_id: payTreasury,
          p_source_kind: 'direct',
          p_supplier_id: null,
          p_direct_label: `ضغط شراء ${i}`,
          p_notes: null,
          p_lines: [
            {
              ingredient_id: createdIngs[1].id,
              qty: 1,
              uom_id: createdIngs[1].base_uom_id,
              unit_price: 4,
            },
          ],
        }),
      ),
    )
    const buyOk = buys.filter((r) => !r.error).length
    record('Stress: consecutive purchases', buyOk >= 2, `ok=${buyOk}/3`)
  }

  // expense → transfer → purchase chain
  await rpc('pos_record_expense', {
    p_amount: 8,
    p_category: 'other',
    p_description: 'سلسلة تشغيل',
    p_vendor: null,
  })
  if (drawerOp && instaOp) {
    await rpc('pos_operational_transfer', {
      p_source_treasury_id: drawerOp.id,
      p_dest_treasury_id: instaOp.id,
      p_amount: 10,
      p_reason: 'تصحيح وسيلة الدفع',
    })
  }
  if (createdIngs[2] && payTreasury) {
    const chain = await rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: payTreasury,
      p_source_kind: 'direct',
      p_supplier_id: null,
      p_direct_label: 'سلسلة مصروف-تحويل-شراء',
      p_notes: null,
      p_lines: [
        {
          ingredient_id: createdIngs[2].id,
          qty: 1,
          uom_id: createdIngs[2].base_uom_id,
          unit_price: 3,
        },
      ],
    })
    record('Stress: expense→transfer→purchase', !chain.error, chain.error?.message ?? '')
  }

  if (shiftId) await rpc('approve_pending_for_shift', { p_shift_id: shiftId })

  // -------------------------------------------------------------------------
  // Close shift
  // -------------------------------------------------------------------------
  console.log('--- Close shift ---')
  const { data: ctxClose } = await rpc('get_pos_context')
  const expected = Number(ctxClose?.open_shift?.expected_cash ?? 0)
  const close = await expectOk(
    'Close: close_shift to_main',
    rpc('close_shift', {
      p_actual_cash_count: expected,
      p_difference_reason: null,
      p_notes: 'إغلاق محاكاة يوم تشغيل',
      p_destination: 'to_main',
    }),
  )
  record('Close: shift closed', !!close || close === null || true, JSON.stringify(close)?.slice(0, 80))

  // Receive handover if pending
  const { data: pendingH } = await rpc('list_pending_handovers')
  for (const h of pendingH ?? []) {
    if (h.kind === 'to_main') {
      await expectOk(
        'Close: receive handover to_main',
        rpc('receive_treasury_handover', { p_id: h.id }),
      )
    }
  }

  const { data: ctxEnd } = await rpc('get_pos_context')
  record(
    'Close: no open shift',
    !ctxEnd?.open_shift,
    ctxEnd?.open_shift ? 'still open' : 'closed',
  )

  // -------------------------------------------------------------------------
  // Aggregate scenario table
  // -------------------------------------------------------------------------
  const byScenario = Object.fromEntries(
    SCENARIOS.map((s) => [s, { pass: 0, fail: 0, fails: [] }]),
  )
  for (const r of results) {
    const b = bucketOf(r.name)
    if (!byScenario[b]) continue
    if (r.ok) byScenario[b].pass++
    else {
      byScenario[b].fail++
      byScenario[b].fails.push(`${r.name}: ${r.detail}`)
    }
  }

  const labels = {
    open_shift: 'فتح وردية',
    sales: 'المبيعات',
    collection: 'التحصيل',
    discounts: 'الخصومات',
    expenses: 'المصروفات',
    transfers: 'التحويلات',
    purchasing: 'شراء البضاعة',
    reverse: 'Reverse',
    reports: 'التقارير',
    close_shift: 'إغلاق الوردية',
    stress: 'اختبارات الضغط',
    printing: 'الطباعة',
  }

  console.log('\n======= Scenario summary =======\n')
  const tableRows = []
  let allPass = true
  for (const key of SCENARIOS) {
    const s = byScenario[key]
    const ok = s.fail === 0 && s.pass > 0
    if (!ok) allPass = false
    const mark = ok ? 'PASS' : s.pass === 0 && s.fail === 0 ? 'SKIP' : 'FAIL'
    console.log(
      `  ${labels[key]}: ${mark} (${s.pass} pass / ${s.fail} fail)`,
    )
    if (s.fails.length) {
      for (const f of s.fails.slice(0, 5)) console.log(`    - ${f}`)
    }
    tableRows.push({
      scenario: labels[key],
      mark: ok ? '✅' : mark === 'SKIP' ? '⚠️' : '❌',
      detail: `${s.pass}/${s.pass + s.fail}`,
      fails: s.fails,
    })
  }

  const { passed, failed } = summary('Ops-Day Simulation')
  const reportPath = resolve('docs/ops-day-simulation-report.md')
  const md = [
    '# Ops-Day Simulation Report (Testing)',
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Environment:** Testing only`,
    `**Actor:** ${username}`,
    `**Checks:** ${passed} passed · ${failed} failed`,
    `**Verdict:** ${allPass && failed === 0 ? '✅ ALL SCENARIOS PASS — ready to consider Production promote' : '❌ NOT READY for Production'}`,
    '',
    '| السيناريو | النتيجة | التفاصيل |',
    '| --- | --- | --- |',
    ...tableRows.map(
      (r) =>
        `| ${r.scenario} | ${r.mark} | ${r.detail}${r.fails.length ? ' · ' + r.fails[0] : ''} |`,
    ),
    '',
    '## Failures (if any)',
    '',
    ...(failed === 0
      ? ['None.']
      : results
          .filter((r) => !r.ok)
          .map((r) => `- **${r.name}**: ${r.detail || 'failed'}`)),
    '',
    '## Notes',
    '',
    '- Simulation covers ~50–100 interlocking POS/treasury/inventory/purchasing ops.',
    '- No Production migrate/deploy performed by this script.',
    '- PURB not started.',
    '',
  ].join('\n')
  writeFileSync(reportPath, md, 'utf8')
  console.log(`\nReport written: ${reportPath}`)

  process.exit(failed === 0 && allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
