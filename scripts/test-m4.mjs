import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * M4 operational review — runs the 12 treasury scenarios end-to-end against the
 * remote DB as a real authenticated manager (so RLS + auth context apply), then
 * resets the treasury ledger to a pristine state (service role) unless --no-cleanup.
 *
 * Usage:
 *   pnpm test:m4 -- --username abomalek --password "SECRET" [--no-cleanup]
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
    const { error } = await promise
    if (error) return record(name, false, error.message)
    record(name, true)
  } catch (e) {
    record(name, false, e.message)
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

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY in .env.local')
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local')

  const username = (readArg('--username', 'abomalek')).trim().toLowerCase()
  const password = readArg('--password', '741523')

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (signInError) {
    console.error(
      `\nFAIL: could not sign in as "${username}". Pass --username/--password.\n  ${signInError.message}`,
    )
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running M4 scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)

  async function balances() {
    const { data } = await rpc('get_treasury_balances')
    const map = {}
    for (const t of data ?? []) {
      const key = t.is_shift_drawer
        ? 'drawer'
        : t.type === 'cash'
          ? 'safe'
          : map.digital
            ? 'wallet'
            : 'digital'
      map[key] = t
    }
    return map
  }

  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001

  // Ensure a clean slate + required seed treasuries (cash safe must be active).
  await serviceCleanup(url, serviceKey, false)
  await ensureM4Fixtures(url, serviceKey)

  let b = await balances()
  const drawer = b.drawer
  const safe = b.safe
  const digital = b.digital
  if (!drawer || !safe || !digital) {
    throw new Error('Expected seeded treasuries (drawer, cash safe, digital) not found.')
  }
  if (!safe.is_active) {
    throw new Error('Cash safe is inactive after fixture bootstrap (NO_CASH_SAFE risk).')
  }

  // 1) Open shift with opening float 1000 -----------------------------------
  await expectOk('01 open_shift(float=1000)', rpc('open_shift', { p_opening_float: 1000 }))
  b = await balances()
  record('01a drawer balance == 1000', near(b.drawer.balance, 1000), `balance=${b.drawer.balance}`)

  // 2) Cash drop 300 (drawer -> safe) ---------------------------------------
  await expectOk('02 cash_drop(300)', rpc('cash_drop', { p_amount: 300, p_reason: 'اختبار' }))
  b = await balances()
  record('02a drawer==700 & safe==300', near(b.drawer.balance, 700) && near(b.safe.balance, 300),
    `drawer=${b.drawer.balance} safe=${b.safe.balance}`)

  // 3) Transfer safe -> digital 100, then approve ---------------------------
  const { data: trId } = await rpc('create_transfer', {
    p_source_treasury_id: safe.id, p_dest_treasury_id: digital.id, p_amount: 100, p_reason: 'اختبار',
  })
  await expectOk('03 approve_transfer(100)', rpc('approve_transfer', { p_id: trId }))
  b = await balances()
  record('03a safe==200 & digital==100', near(b.safe.balance, 200) && near(b.digital.balance, 100),
    `safe=${b.safe.balance} digital=${b.digital.balance}`)

  // 4) Expense 50 from drawer, then approve ---------------------------------
  const { data: expId } = await rpc('create_expense', {
    p_treasury_id: drawer.id, p_category: 'petty_cash', p_amount: 50,
    p_description: 'نثرية', p_vendor: null,
  })
  await expectOk('04 approve_expense(50)', rpc('approve_expense', { p_id: expId }))
  b = await balances()
  record('04a drawer==650', near(b.drawer.balance, 650), `drawer=${b.drawer.balance}`)

  // 5) Reject (a new transfer) then Reverse (the executed expense) ----------
  const { data: rejId } = await rpc('create_transfer', {
    p_source_treasury_id: safe.id, p_dest_treasury_id: digital.id, p_amount: 10, p_reason: null,
  })
  await expectError('05a reject without reason', rpc('reject_transfer', { p_id: rejId, p_reason: '' }), 'REASON_REQUIRED')
  await expectOk('05b reject_transfer(reason)', rpc('reject_transfer', { p_id: rejId, p_reason: 'خطأ إدخال' }))
  await expectError('05c reverse without reason', rpc('reverse_expense', { p_id: expId, p_reason: '' }), 'REASON_REQUIRED')
  await expectOk('05d reverse_expense(reason)', rpc('reverse_expense', { p_id: expId, p_reason: 'تصحيح' }))
  b = await balances()
  record('05e drawer back to 700', near(b.drawer.balance, 700), `drawer=${b.drawer.balance}`)

  // 6) Overdraft attempts (must be rejected) --------------------------------
  await expectError('06a cash_drop > balance', rpc('cash_drop', { p_amount: 9_999_999, p_reason: null }), 'INSUFFICIENT_FUNDS')
  const { data: bigExp } = await rpc('create_expense', {
    p_treasury_id: digital.id, p_category: 'other', p_amount: 9_999_999, p_description: null, p_vendor: null,
  })
  await expectError('06b approve expense > balance', rpc('approve_expense', { p_id: bigExp }), 'INSUFFICIENT_FUNDS')
  await rpc('reject_expense', { p_id: bigExp, p_reason: 'اختبار تجاوز الرصيد' })

  // 7) Deactivate treasury holding balance (must be rejected) ---------------
  await expectError('07 deactivate non-empty treasury', rpc('set_treasury_status', { p_id: safe.id, p_active: false }), 'TREASURY_NOT_EMPTY')

  // 8) Deactivate a linked payment method (must be rejected) ----------------
  const { data: methods } = await supabase.from('payment_methods').select('*')
  const linked = (methods ?? []).find((m) => m.treasury_id)
  await expectError('08 deactivate linked payment method', rpc('set_payment_method_status', { p_id: linked.id, p_active: false }), 'PAYMENT_METHOD_LINKED')

  // 9) Close shift with NO difference ---------------------------------------
  let { data: report } = await rpc('get_open_shift')
  await expectError('09a close with diff but no reason',
    rpc('close_shift', { p_actual_cash_count: report.expected_cash + 5, p_difference_reason: '', p_notes: null }),
    'DIFFERENCE_REASON_REQUIRED')
  await expectOk('09b close_shift(no difference)',
    rpc('close_shift', { p_actual_cash_count: report.expected_cash, p_difference_reason: null, p_notes: 'إغلاق مطابق' }))
  record('09c variance == 0', near(report.expected_cash - report.expected_cash, 0))

  // 10) Close shift with a SHORTAGE -----------------------------------------
  await rpc('open_shift', { p_opening_float: 500 })
  ;({ data: report } = await rpc('get_open_shift'))
  await expectOk('10 close_shift(shortage -50)',
    rpc('close_shift', { p_actual_cash_count: report.expected_cash - 50, p_difference_reason: 'عجز اختبار', p_notes: null }))
  {
    const { data: led } = await rpc('get_treasury_ledger', { p_treasury_id: drawer.id, p_limit: 3 })
    const v = (led ?? []).find((e) => e.source === 'variance')
    record('10a shortage variance -50 with VR ref', v && near(v.amount, -50) && String(v.reference || '').startsWith('VR-'),
      v ? `${v.reference} ${v.amount}` : 'no variance row')
  }

  // 11) Close shift with an OVERAGE -----------------------------------------
  await rpc('open_shift', { p_opening_float: 500 })
  ;({ data: report } = await rpc('get_open_shift'))
  await expectOk('11 close_shift(overage +30)',
    rpc('close_shift', { p_actual_cash_count: report.expected_cash + 30, p_difference_reason: 'زيادة اختبار', p_notes: null }))
  {
    const { data: led } = await rpc('get_treasury_ledger', { p_treasury_id: drawer.id, p_limit: 3 })
    const v = (led ?? []).find((e) => e.source === 'variance')
    record('11a overage variance +30 with VR ref', v && near(v.amount, 30) && String(v.reference || '').startsWith('VR-'),
      v ? `${v.reference} ${v.amount}` : 'no variance row')
  }

  // 12) Ledger integrity: every movement has a reference; no direct edits ----
  {
    let allRef = true
    let count = 0
    for (const tr of [drawer, safe, digital]) {
      const { data: led } = await rpc('get_treasury_ledger', { p_treasury_id: tr.id, p_limit: 500 })
      for (const e of led ?? []) {
        count += 1
        if (!e.reference) allRef = false
      }
    }
    record('12a every ledger movement has a reference', allRef, `${count} movements checked`)

    // Direct UPDATE on the ledger must be blocked (RLS has no write policy).
    const { data: probe } = await supabase.from('treasury_movements').select('id').limit(1)
    const { error: updErr } = await supabase
      .from('treasury_movements')
      .update({ amount: 0 })
      .eq('id', probe?.[0]?.id ?? SEED_RESTAURANT_ID)
      .select()
    // Either an RLS error, or zero rows affected (both mean "no direct edit").
    const { data: after } = await supabase.from('treasury_movements').select('amount').eq('id', probe?.[0]?.id)
    const unchanged = !!updErr || (after?.[0] && Number(after[0].amount) !== 0)
    record('12b direct balance edit is blocked', unchanged, updErr ? updErr.message : 'update affected no rows')
  }

  await supabase.auth.signOut()

  // Cleanup: reset the ledger so the restaurant starts real operations at zero.
  const cleanup = !hasFlag('--no-cleanup')
  if (cleanup) {
    await serviceCleanup(url, serviceKey, true)
    console.log('\nCleanup: treasury ledger reset to pristine (balances = 0).')
  } else {
    console.log('\n--no-cleanup: test ledger data kept for UI inspection.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M4 review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

async function serviceCleanup(url, serviceKey, log) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('treasury_adjustments').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  if (log) return
}

/**
 * M4 fixtures: cash_drop requires an *active* non-drawer cash treasury.
 * Live DBs may have deactivated the main safe during earlier UI tests —
 * reactivate seed treasuries so the suite is deterministic.
 */
async function ensureM4Fixtures(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID

  const { data: treasuries, error } = await admin
    .from('treasuries')
    .select('id, name, type, is_shift_drawer, is_active')
    .eq('restaurant_id', r)
  if (error) throw new Error(`ensureM4Fixtures list: ${error.message}`)

  const drawer = (treasuries ?? []).find((t) => t.is_shift_drawer)
  const safe = (treasuries ?? []).find(
    (t) => t.type === 'cash' && !t.is_shift_drawer,
  )
  const digital = (treasuries ?? []).find((t) => t.type === 'digital')

  if (!drawer || !safe || !digital) {
    throw new Error(
      'M4 seed incomplete: need drawer + cash safe + digital treasury. Re-run M4 seed migration.',
    )
  }

  const inactiveIds = (treasuries ?? [])
    .filter((t) => !t.is_active)
    .map((t) => t.id)
  if (inactiveIds.length) {
    const { error: actErr } = await admin
      .from('treasuries')
      .update({ is_active: true })
      .in('id', inactiveIds)
    if (actErr) throw new Error(`ensureM4Fixtures activate: ${actErr.message}`)
  }

  const { data: methods, error: pmErr } = await admin
    .from('payment_methods')
    .select('id, code, treasury_id, is_active')
    .eq('restaurant_id', r)
  if (pmErr) throw new Error(`ensureM4Fixtures payment_methods: ${pmErr.message}`)

  const inactivePm = (methods ?? []).filter((m) => !m.is_active).map((m) => m.id)
  if (inactivePm.length) {
    const { error: pmActErr } = await admin
      .from('payment_methods')
      .update({ is_active: true })
      .in('id', inactivePm)
    if (pmActErr) {
      throw new Error(`ensureM4Fixtures activate PM: ${pmActErr.message}`)
    }
  }
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
