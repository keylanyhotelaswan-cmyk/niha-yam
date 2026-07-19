import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * PURB — Credit purchases + supplier ledger (Testing only).
 *
 * Usage:
 *   pnpm test:purb
 *   pnpm test:purb -- --username manager --password "Testing123!"
 */

const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

function readArg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}

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

async function expectError(name, promise, code) {
  try {
    const { error } = await promise
    if (error && error.message.includes(code))
      record(name, true, `rejected: ${code}`)
    else if (error) record(name, false, `wrong error: ${error.message}`)
    else record(name, false, 'expected rejection but succeeded')
  } catch (e) {
    if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)
  if (!anon) {
    console.error('Missing VITE_SUPABASE_ANON_KEY in .env.testing')
    process.exit(1)
  }

  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const supabase = createClient(url, anon, {
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
  console.log(`\n[Testing] Signed in as ${username}. Running PURB scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  let ings = await expectOk(
    '01 list_ingredients',
    rpc('list_ingredients', { p_active_only: true }),
  )
  let ingredientId = ings?.[0]?.id
  let uomId = ings?.[0]?.base_uom_id
  if (!ingredientId) {
    const uoms = await rpc('rc_bootstrap_uoms')
    const kg = (uoms.data ?? []).find((u) => u.code === 'kg')
    const created = await expectOk(
      '01b create ingredient',
      rpc('upsert_ingredient', {
        p_id: null,
        p_name_ar: `آجل-اختبار-${Date.now()}`,
        p_name_en: null,
        p_code: null,
        p_base_uom_id: kg.id,
        p_standard_cost: 10,
        p_is_active: true,
      }),
    )
    ingredientId = created?.id
    uomId = kg.id
  } else {
    record('01b create ingredient', true, 'reused existing')
  }

  const { data: treasuries, error: trErr } = await supabase
    .from('treasuries')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  if (trErr) {
    record('02 list treasuries', false, trErr.message)
  } else {
    record('02 list treasuries', true, `n=${treasuries.length}`)
  }
  const treasury =
    treasuries?.find((t) => t.type === 'cash' && !t.is_shift_drawer) ??
    treasuries?.[0]
  if (!treasury) {
    console.error('No treasury available')
    process.exit(1)
  }

  const balRes = await supabase.rpc('treasury_balance', {
    p_treasury_id: treasury.id,
  })
  let bal = Number(balRes.data ?? 0)
  if (bal < 500) {
    const adj = await expectOk(
      '02b deposit for payment funds',
      rpc('create_adjustment', {
        p_treasury_id: treasury.id,
        p_kind: 'deposit',
        p_amount: 1000,
        p_reason: 'PURB test float',
      }),
    )
    if (adj) {
      await expectOk('02c approve deposit', rpc('approve_adjustment', { p_id: adj }))
    }
  } else {
    record('02b deposit for payment funds', true, `balance=${bal}`)
    record('02c approve deposit', true, 'skipped')
  }

  const balBeforeCredit = Number(
    (await supabase.rpc('treasury_balance', { p_treasury_id: treasury.id })).data ??
      0,
  )

  const supplier = await expectOk(
    '03 upsert supplier',
    rpc('pur_upsert_supplier', {
      p_id: null,
      p_name_ar: `مورد-آجل-${Date.now()}`,
      p_name_en: null,
      p_code: `C-${Date.now().toString().slice(-6)}`,
      p_phone: '01000000001',
      p_notes: 'PURB',
      p_is_active: true,
    }),
  )

  await expectError(
    '04 reject credit without supplier',
    rpc('pur_post_credit_purchase', {
      p_supplier_id: null,
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 1,
          uom_id: uomId,
          unit_price: 10,
        },
      ],
    }),
    'SUPPLIER_REQUIRED',
  )

  const credit = await expectOk(
    '05 post credit purchase',
    rpc('pur_post_credit_purchase', {
      p_supplier_id: supplier?.id,
      p_notes: 'PURB suite credit',
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 2,
          uom_id: uomId,
          unit_price: 25,
        },
      ],
    }),
  )
  record(
    '05a credit total + method',
    !!credit?.reference &&
      Number(credit?.total_amount) === 50 &&
      credit?.payment_method === 'credit',
    `ref=${credit?.reference} total=${credit?.total_amount}`,
  )

  const balAfterCredit = Number(
    (await supabase.rpc('treasury_balance', { p_treasury_id: treasury.id })).data ??
      0,
  )
  record(
    '06 treasury unchanged on credit',
    balAfterCredit === balBeforeCredit,
    `before=${balBeforeCredit} after=${balAfterCredit}`,
  )

  const { data: stockMoves } = await supabase
    .from('stock_movements')
    .select('id, movement_type, source_type, source_id')
    .eq('source_type', 'purchase_line')
    .eq('source_id', credit?.lines?.[0]?.id)
  record(
    '07 inventory receive on credit',
    Array.isArray(stockMoves) &&
      stockMoves.some((m) => m.movement_type === 'receive'),
    `n=${stockMoves?.length}`,
  )

  const balOpen = await expectOk(
    '08 supplier balance',
    rpc('pur_get_supplier_balance', { p_supplier_id: supplier?.id }),
  )
  record(
    '08a open balance = 50',
    Number(balOpen?.open_balance) === 50,
    `open=${balOpen?.open_balance}`,
  )

  const stmt = await expectOk(
    '09 supplier statement',
    rpc('pur_get_supplier_statement', {
      p_supplier_id: supplier?.id,
      p_limit: 50,
    }),
  )
  record(
    '09a statement has credit purchase',
    Array.isArray(stmt?.entries) &&
      stmt.entries.some(
        (e) => e.kind === 'credit_purchase' && e.doc_id === credit?.id,
      ),
    `entries=${stmt?.entries?.length}`,
  )

  // Partial payment
  const pay1 = await expectOk(
    '10 partial supplier payment',
    rpc('pur_post_supplier_payment', {
      p_supplier_id: supplier?.id,
      p_treasury_id: treasury.id,
      p_amount: 20,
      p_notes: 'partial',
    }),
  )
  record(
    '10a open after partial = 30',
    Number(pay1?.open_balance_after) === 30,
    `after=${pay1?.open_balance_after}`,
  )

  const { data: payMovements } = await supabase
    .from('treasury_movements')
    .select('source, amount, source_ref_type, source_ref_id')
    .eq('source_ref_id', pay1?.id)
  record(
    '11 treasury supplier_payment movement',
    Array.isArray(payMovements) &&
      payMovements.some(
        (m) =>
          m.source === 'supplier_payment' &&
          Number(m.amount) === -20 &&
          m.source_ref_type === 'supplier_payment',
      ),
    `n=${payMovements?.length}`,
  )

  await expectError(
    '12 reverse credit blocked while payments exist',
    rpc('pur_reverse_credit_purchase', {
      p_id: credit?.id,
      p_reason: 'يجب أن يُرفض',
    }),
    'HAS_PAYMENTS',
  )

  await expectError(
    '13 overpayment rejected',
    rpc('pur_post_supplier_payment', {
      p_supplier_id: supplier?.id,
      p_treasury_id: treasury.id,
      p_amount: 1000,
      p_notes: 'over',
    }),
    'OVERPAYMENT',
  )

  const pay2 = await expectOk(
    '14 settle remaining',
    rpc('pur_post_supplier_payment', {
      p_supplier_id: supplier?.id,
      p_treasury_id: treasury.id,
      p_amount: 30,
      p_notes: 'settle',
    }),
  )
  record(
    '14a fully settled',
    Number(pay2?.open_balance_after) === 0,
    `after=${pay2?.open_balance_after}`,
  )

  const revPay2 = await expectOk(
    '15 reverse second payment',
    rpc('pur_reverse_supplier_payment', {
      p_id: pay2?.id,
      p_reason: 'اختبار عكس سداد',
    }),
  )
  record('15a payment reversed', revPay2?.status === 'reversed')

  const balMid = await expectOk(
    '16 balance after reverse payment',
    rpc('pur_get_supplier_balance', { p_supplier_id: supplier?.id }),
  )
  record(
    '16a open = 30 again',
    Number(balMid?.open_balance) === 30,
    `open=${balMid?.open_balance}`,
  )

  // Reverse remaining payment then reverse credit purchase
  await expectOk(
    '17 reverse first payment',
    rpc('pur_reverse_supplier_payment', {
      p_id: pay1?.id,
      p_reason: 'تنظيف قبل عكس الشراء',
    }),
  )

  const balZeroPay = await expectOk(
    '18 balance after all payments reversed',
    rpc('pur_get_supplier_balance', { p_supplier_id: supplier?.id }),
  )
  record(
    '18a open = 50',
    Number(balZeroPay?.open_balance) === 50,
    `open=${balZeroPay?.open_balance}`,
  )

  const revCredit = await expectOk(
    '19 reverse credit purchase',
    rpc('pur_reverse_credit_purchase', {
      p_id: credit?.id,
      p_reason: 'اختبار عكس شراء آجل',
    }),
  )
  record('19a credit reversed', revCredit?.status === 'reversed')

  const balFinal = await expectOk(
    '20 balance after reverse credit',
    rpc('pur_get_supplier_balance', { p_supplier_id: supplier?.id }),
  )
  record(
    '20a open = 0',
    Number(balFinal?.open_balance) === 0,
    `open=${balFinal?.open_balance}`,
  )

  await expectError(
    '21 double reverse credit rejected',
    rpc('pur_reverse_credit_purchase', {
      p_id: credit?.id,
      p_reason: 'again',
    }),
    'INVALID_STATE',
  )

  // Cashier denied credit
  const cashier = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: cashAuth } = await cashier.auth.signInWithPassword({
    email: `cashier@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (cashAuth) {
    record('22 cashier sign-in', false, cashAuth.message)
  } else {
    record('22 cashier sign-in', true)
    await expectError(
      '23 cashier cannot post credit',
      cashier.rpc('pur_post_credit_purchase', {
        p_supplier_id: supplier?.id,
        p_notes: null,
        p_lines: [
          {
            ingredient_id: ingredientId,
            qty: 1,
            uom_id: uomId,
            unit_price: 1,
          },
        ],
      }),
      'PERMISSION_DENIED',
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nPURB: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
