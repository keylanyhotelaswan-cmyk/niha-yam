import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'

/**
 * Testing smoke: full shift-close print snapshot shape.
 *
 *   pnpm exec node scripts/smoke-handover-print-report.mjs --username abomalek --password "SECRET"
 */

const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

function readArg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}

function record(name, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  assertTestingTarget(url)

  const username = readArg(
    '--username',
    env.TESTING_CASHIER_USERNAME || env.TESTING_MANAGER_USERNAME || 'abomalek',
  )
    .trim()
    .toLowerCase()
  const password = readArg(
    '--password',
    env.TESTING_CASHIER_PASSWORD || env.TESTING_MANAGER_PASSWORD || '',
  )
  if (!password) throw new Error('Missing Testing password (TESTING_CASHIER_PASSWORD)')
  const email = `${username}@${INTERNAL_EMAIL_DOMAIN}`

  const sb = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password })
  if (authErr) throw new Error(`Testing login failed: ${authErr.message}`)
  const rpc = (fn, args = {}) => sb.rpc(fn, args)

  console.log(`\n[Testing only] Handover full-report snapshot as ${username}…\n`)

  const { data: pending } = await rpc('list_pending_handovers')
  let hid = pending?.[0]?.id
  if (!hid) {
    const { data: archive } = await sb
      .from('shift_handovers')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
    hid = archive?.[0]?.id
  }
  if (!hid) {
    console.error('No handover row found to snapshot. Close a shift on Testing first.')
    process.exit(1)
  }

  const { data: snap, error } = await rpc('m6_build_handover_print_snapshot', {
    p_handover_id: hid,
    p_phase: 'handover',
  })
  if (error) throw new Error(error.message)

  let failed = 0
  const check = (name, ok, detail) => {
    if (!record(name, ok, detail)) failed++
  }

  const sections = {
    title: snap?.title_ar,
    ops: snap?.ops,
    payment_methods: snap?.payment_methods,
    top_items_by_revenue: snap?.top_items_by_revenue,
    top_items_by_qty: snap?.top_items_by_qty,
    cash: snap?.cash,
  }

  check('01 title is report', String(snap?.title_ar ?? '').includes('تقرير'), snap?.title_ar)
  check('02 document_type', snap?.document_type === 'shift_handover')
  check('03 no designer layout', snap?.layout == null)
  check('04 ops.sales_total', typeof snap?.ops?.sales_total === 'number', String(snap?.ops?.sales_total))
  check('05 ops.orders_count', typeof snap?.ops?.orders_count === 'number', String(snap?.ops?.orders_count))
  check('06 ops.avg_ticket', typeof snap?.ops?.avg_ticket === 'number', String(snap?.ops?.avg_ticket))
  check('07 ops.expenses_total', typeof snap?.ops?.expenses_total === 'number', String(snap?.ops?.expenses_total))
  check('08 ops.discounts_total', typeof snap?.ops?.discounts_total === 'number')
  check('09 ops.refunds_total', typeof snap?.ops?.refunds_total === 'number')
  check('10 cash.opening_float', typeof snap?.cash?.opening_float === 'number')
  check('11 cash.expected_cash', typeof snap?.cash?.expected_cash === 'number', String(snap?.cash?.expected_cash))
  check('12 cash.actual_cash', typeof snap?.cash?.actual_cash === 'number')
  check('13 cash.trust_amount', typeof snap?.cash?.trust_amount === 'number')
  check('14 payment_methods array', Array.isArray(snap?.payment_methods), `n=${snap?.payment_methods?.length ?? 0}`)
  check('15 top_items_by_revenue', Array.isArray(snap?.top_items_by_revenue), `n=${snap?.top_items_by_revenue?.length ?? 0}`)
  check('16 top_items_by_qty', Array.isArray(snap?.top_items_by_qty), `n=${snap?.top_items_by_qty?.length ?? 0}`)

  console.log('\n--- Report sections review ---')
  console.log(JSON.stringify({
    title_ar: sections.title,
    ops: sections.ops,
    payment_methods_count: sections.payment_methods?.length ?? 0,
    payment_methods: sections.payment_methods,
    top_items_by_revenue: sections.top_items_by_revenue,
    top_items_by_qty: sections.top_items_by_qty,
    cash: sections.cash,
    handover_reference: snap?.handover_reference,
    shift_reference: snap?.shift_reference,
    destination_label_ar: snap?.destination_label_ar,
  }, null, 2))

  console.log(
    `\nSnapshot ok — sales=${snap.ops.sales_total} orders=${snap.ops.orders_count} ` +
      `avg=${snap.ops.avg_ticket} expenses=${snap.ops.expenses_total} trust=${snap.cash.trust_amount}`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
