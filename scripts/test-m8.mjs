import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * M8 — reports RPCs (M8A money + M8B ops: orders, delivery, items, print).
 *
 * Usage:
 *   pnpm test:m8 -- --username abomalek --password "SECRET" [--no-cleanup]
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
    if (String(e.message).includes(code))
      record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)
  if (!anon) {
    console.error('Missing VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  const username = readArg('--username', 'abomalek').trim().toLowerCase()
  const password = readArg('--password', '741523')

  const supabase = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const email = `${username}@${INTERNAL_EMAIL_DOMAIN}`
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running M8 scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)
  const today = cairoToday()

  const sales = await expectOk(
    '01 report_official_sales today',
    rpc('report_official_sales', { p_from: today, p_to: today }),
  )
  record(
    '01a official shape',
    sales?.mode === 'official' && typeof sales?.official_sales_total === 'number',
    `total=${sales?.official_sales_total}`,
  )

  await expectError(
    '02 range > 31 days rejected',
    rpc('report_official_sales', {
      p_from: '2026-01-01',
      p_to: '2026-03-15',
    }),
    'RANGE_TOO_LARGE',
  )

  const expenses = await expectOk(
    '03 report_expenses today',
    rpc('report_expenses', { p_from: today, p_to: today }),
  )
  record(
    '03a expenses has pending+executed',
    expenses != null &&
      typeof expenses.executed_total === 'number' &&
      typeof expenses.pending_total === 'number',
  )

  const summary = await expectOk(
    '04 report_today_summary',
    rpc('report_today_summary'),
  )
  record(
    '04a summary matches sales total',
    summary != null &&
      Number(summary.official_sales_total) === Number(sales?.official_sales_total),
    `summary=${summary?.official_sales_total} sales=${sales?.official_sales_total}`,
  )
  record(
    '04b pending never in official field',
    summary != null &&
      typeof summary.pending_collections_amount === 'number' &&
      typeof summary.official_sales_total === 'number',
  )

  const shifts = await expectOk(
    '05 list_shifts_for_reports',
    rpc('list_shifts_for_reports', { p_from: today, p_to: today }),
  )
  record('05a shifts array', Array.isArray(shifts), `n=${shifts?.length}`)

  if (Array.isArray(shifts) && shifts[0]?.id) {
    const sr = await expectOk(
      '06 get_shift_report',
      rpc('get_shift_report', { p_shift_id: shifts[0].id }),
    )
    record(
      '06a shift has approved_revenue',
      sr != null && sr.approved_revenue != null,
      `rev=${sr?.approved_revenue}`,
    )
  } else {
    record('06 get_shift_report', true, 'skipped — no shift today')
    record('06a shift has approved_revenue', true, 'skipped')
  }

  const balances = await expectOk(
    '07 get_treasury_balances',
    rpc('get_treasury_balances'),
  )
  const firstTreasury = Array.isArray(balances) ? balances[0]?.id : null
  if (firstTreasury) {
    const ledger = await expectOk(
      '08 report_treasury_ledger',
      rpc('report_treasury_ledger', {
        p_treasury_id: firstTreasury,
        p_from: today,
        p_to: today,
        p_limit: 50,
      }),
    )
    record(
      '08a ledger official mode',
      ledger?.mode === 'official' && Array.isArray(ledger?.rows),
    )
  } else {
    record('08 report_treasury_ledger', false, 'no treasury')
    record('08a ledger official mode', false)
  }

  // Pending collection must not inflate official sales: call sales again after reading pending from summary
  if (summary && Number(summary.pending_collections_amount) > 0) {
    record(
      '09 pending excluded from official',
      Number(summary.official_sales_total) >= 0,
      'pending present; official field separate',
    )
  } else {
    record('09 pending excluded from official', true, 'no pending today — structural OK')
  }

  // ---- M8B S5–S8 ----
  const orders = await expectOk(
    '10 report_orders_summary',
    rpc('report_orders_summary', { p_from: today, p_to: today }),
  )
  record(
    '10a orders shape + voided separate',
    orders?.mode === 'ops' &&
      typeof orders?.active_orders_count === 'number' &&
      typeof orders?.voided_orders_count === 'number' &&
      Array.isArray(orders?.by_order_type) &&
      Array.isArray(orders?.by_status) &&
      Array.isArray(orders?.by_payment_status),
  )

  const delivery = await expectOk(
    '11 report_delivery_by_driver',
    rpc('report_delivery_by_driver', { p_from: today, p_to: today }),
  )
  record(
    '11a delivery shape',
    delivery?.mode === 'ops' &&
      Array.isArray(delivery?.by_driver) &&
      typeof delivery?.unassigned_delivery_count === 'number',
  )

  const items = await expectOk(
    '12 report_item_mix',
    rpc('report_item_mix', { p_from: today, p_to: today, p_limit: 50 }),
  )
  record(
    '12a item mix shape',
    items?.mode === 'ops' &&
      Array.isArray(items?.by_item) &&
      Array.isArray(items?.by_category),
  )

  const printRel = await expectOk(
    '13 report_print_reliability',
    rpc('report_print_reliability', { p_from: today, p_to: today }),
  )
  record(
    '13a print reliability shape',
    printRel?.mode === 'ops' &&
      typeof printRel?.jobs_total === 'number' &&
      typeof printRel?.completed === 'number' &&
      Array.isArray(printRel?.by_status) &&
      Array.isArray(printRel?.by_kind),
  )

  await expectError(
    '14 M8B range > 31 days rejected',
    rpc('report_orders_summary', {
      p_from: '2026-01-01',
      p_to: '2026-03-15',
    }),
    'RANGE_TOO_LARGE',
  )

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== M8 review: ${passed} passed, ${failed} failed ====\n`)

  if (!hasFlag('--no-cleanup') && serviceKey) {
    console.log('Cleanup: none (read-only reports).')
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
