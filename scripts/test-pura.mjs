import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'
import { ensureOperatingFunds } from './liq-test-helpers.mjs'

/**
 * PURA — Direct cash purchase + suppliers (Testing only).
 *
 * Usage:
 *   pnpm test:pura
 *   pnpm test:pura -- --username manager --password "Testing123!"
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
  console.log(`\n[Testing] Signed in as ${username}. Running PURA scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  // Ensure ingredient + treasury
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
        p_name_ar: `شراء-اختبار-${Date.now()}`,
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

  const standardCostBefore = (
    await rpc('list_ingredients', { p_active_only: true })
  ).data?.find((i) => i.id === ingredientId)?.standard_cost

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

  // Ensure physical + operating funds (reserved can cap operating)
  const balRes = await supabase.rpc('treasury_balance', {
    p_treasury_id: treasury.id,
  })
  let bal = Number(balRes.data ?? 0)
  if (bal < 500) {
    await expectOk(
      '02b deposit for purchase funds',
      rpc('create_adjustment', {
        p_treasury_id: treasury.id,
        p_kind: 'deposit',
        p_amount: 1000,
        p_reason: 'PURA test float',
      }),
    )
  } else {
    record('02b deposit for purchase funds', true, `balance=${bal}`)
  }
  await ensureOperatingFunds(rpc, record, {
    treasuryId: treasury.id,
    minOperating: 500,
    label: '02c',
  })

  // Supplier master
  const supplier = await expectOk(
    '03 upsert supplier',
    rpc('pur_upsert_supplier', {
      p_id: null,
      p_name_ar: `مورد-اختبار-${Date.now()}`,
      p_name_en: null,
      p_code: `S-${Date.now().toString().slice(-6)}`,
      p_phone: '01000000000',
      p_notes: 'PURA',
      p_is_active: true,
    }),
  )

  await expectOk('04 list suppliers', rpc('pur_list_suppliers', { p_active_only: true }))

  // Reject: direct without label
  await expectError(
    '05 reject direct without label',
    rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: treasury.id,
      p_source_kind: 'direct',
      p_supplier_id: null,
      p_direct_label: '',
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 1,
          uom_id: uomId,
          unit_price: 5,
        },
      ],
    }),
    'DIRECT_LABEL_REQUIRED',
  )

  // Reject: supplier source without supplier
  await expectError(
    '06 reject supplier without id',
    rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: treasury.id,
      p_source_kind: 'supplier',
      p_supplier_id: null,
      p_direct_label: null,
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 1,
          uom_id: uomId,
          unit_price: 5,
        },
      ],
    }),
    'SUPPLIER_REQUIRED',
  )

  // Happy path: direct cash
  const posted = await expectOk(
    '07 post direct cash purchase',
    rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: treasury.id,
      p_source_kind: 'direct',
      p_supplier_id: null,
      p_direct_label: 'سوق الاختبار',
      p_notes: 'PURA suite',
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 2,
          uom_id: uomId,
          unit_price: 7.5,
        },
      ],
    }),
  )
  record(
    '07a reference + total',
    !!posted?.reference && Number(posted?.total_amount) === 15,
    `ref=${posted?.reference} total=${posted?.total_amount}`,
  )

  // Supplier cash purchase
  const postedSup = await expectOk(
    '08 post supplier cash purchase',
    rpc('pur_post_direct_cash_purchase', {
      p_treasury_id: treasury.id,
      p_source_kind: 'supplier',
      p_supplier_id: supplier?.id,
      p_direct_label: null,
      p_notes: null,
      p_lines: [
        {
          ingredient_id: ingredientId,
          qty: 1,
          uom_id: uomId,
          unit_price: 3,
        },
      ],
    }),
  )

  const listed = await expectOk(
    '09 list purchases',
    rpc('pur_list_purchases', { p_limit: 20 }),
  )
  record(
    '09a contains posted',
    Array.isArray(listed) &&
      listed.some((p) => p.id === posted?.id) &&
      listed.some((p) => p.id === postedSup?.id),
  )

  // standard_cost unchanged (Q-PUR5)
  const afterIng = (
    await rpc('list_ingredients', { p_active_only: true })
  ).data?.find((i) => i.id === ingredientId)
  record(
    '10 standard_cost not auto-updated',
    Number(afterIng?.standard_cost) === Number(standardCostBefore),
    `before=${standardCostBefore} after=${afterIng?.standard_cost}`,
  )

  // Ledger has purchase source
  const { data: movements } = await supabase
    .from('treasury_movements')
    .select('source, amount, source_ref_type, source_ref_id, reference')
    .eq('source_ref_id', posted?.id)
  record(
    '11 treasury purchase movement',
    Array.isArray(movements) &&
      movements.some(
        (m) =>
          m.source === 'purchase' &&
          Number(m.amount) === -15 &&
          m.source_ref_type === 'purchase',
      ),
    `n=${movements?.length}`,
  )

  // Stock movement linked
  const { data: stockMoves } = await supabase
    .from('stock_movements')
    .select('id, movement_type, source_type, source_id')
    .eq('source_type', 'purchase_line')
    .eq('source_id', posted?.lines?.[0]?.id)
  record(
    '12 inventory receive linked',
    Array.isArray(stockMoves) &&
      stockMoves.some((m) => m.movement_type === 'receive'),
    `n=${stockMoves?.length}`,
  )

  // Reverse direct purchase
  let reversed = null
  if (posted?.id) {
    reversed = await expectOk(
      '13 reverse purchase',
      rpc('pur_reverse_direct_cash_purchase', {
        p_id: posted.id,
        p_reason: 'اختبار عكس PURA',
      }),
    )
    record('13a reversed status', reversed?.status === 'reversed')
  } else {
    record('13 reverse purchase', false, 'missing purchase id')
    record('13a reversed status', false, 'missing purchase id')
  }

  if (posted?.id) {
    await expectError(
      '14 reverse again rejected',
      rpc('pur_reverse_direct_cash_purchase', {
        p_id: posted.id,
        p_reason: 'again',
      }),
      'INVALID_STATE',
    )
  } else {
    record('14 reverse again rejected', false, 'missing purchase id')
  }

  // Reverse supplier cash purchase so stock leftovers do not pollute other suites
  if (postedSup?.id) {
    await expectOk(
      '14b reverse supplier cash purchase',
      rpc('pur_reverse_direct_cash_purchase', {
        p_id: postedSup.id,
        p_reason: 'تنظيف بعد اختبار PURA',
      }),
    )
  } else {
    record('14b reverse supplier cash purchase', false, 'missing id')
  }

  // Cashier denied
  const cashierUser = (env.TESTING_CASHIER_USERNAME || 'cashier').trim().toLowerCase()
  const cashierPass = env.TESTING_CASHIER_PASSWORD || password
  const cashier = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: cashAuth } = await cashier.auth.signInWithPassword({
    email: `${cashierUser}@${INTERNAL_EMAIL_DOMAIN}`,
    password: cashierPass,
  })
  if (cashAuth) {
    record('15 cashier sign-in', true, 'skipped — ' + cashAuth.message)
  } else {
    record('15 cashier sign-in', true)
    await expectError(
      '16 cashier cannot post purchase',
      cashier.rpc('pur_post_direct_cash_purchase', {
        p_treasury_id: treasury.id,
        p_source_kind: 'direct',
        p_supplier_id: null,
        p_direct_label: 'ممنوع',
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
    `\nPURA: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
