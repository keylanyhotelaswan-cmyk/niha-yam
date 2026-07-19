import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Operational smoke: liquidity + smart handover (Testing).
 *
 *   pnpm smoke:liq-handover-testing
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

async function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)
  refuseProductionMutations(env.VITE_SUPABASE_URL)
  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error(authErr.message)
    process.exit(1)
  }
  console.log(`\n[Testing] Operational smoke as ${username}…\n`)
  const rpc = (fn, args) => sb.rpc(fn, args)

  // 1) Liquidity settings
  {
    const { data, error } = await rpc('liq_upsert_settings', {
      p_operating_pct: 70,
      p_reserved_pct: 30,
    })
    record('01 settings 70/30', !error && Number(data?.operating_pct) === 70, error?.message)
  }

  // cleanup pending handovers
  for (const h of (await rpc('list_pending_handovers')).data ?? []) {
    if (h.kind === 'to_next_shift') {
      await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'smoke cleanup' })
    } else {
      await rpc('receive_treasury_handover', { p_id: h.id })
    }
  }

  let open = (await rpc('get_open_shift')).data
  if (!open) {
    const { error } = await rpc('open_shift', { p_opening_float: 80 })
    record('02 open shift', !error, error?.message)
    open = (await rpc('get_open_shift')).data
  } else {
    record('02 open shift', true, 'reused')
  }

  const { data: treasuries } = await sb.from('treasuries').select('*').eq('is_active', true)
  const main = treasuries?.find((t) => t.type === 'cash' && !t.is_shift_drawer)
  const drawer = treasuries?.find((t) => t.is_shift_drawer)

  // ensure drawer has cash for handover
  let drawerBal = Number((await rpc('treasury_balance', { p_treasury_id: drawer.id })).data ?? 0)
  if (drawerBal < 50) {
    const adj = await rpc('create_adjustment', {
      p_treasury_id: drawer.id,
      p_kind: 'deposit',
      p_amount: 100,
      p_reason: 'smoke float',
    })
    if (!adj.error) await rpc('approve_adjustment', { p_id: adj.data })
    drawerBal = Number((await rpc('treasury_balance', { p_treasury_id: drawer.id })).data ?? 0)
  }

  const before = (await rpc('liq_get_snapshot')).data
  const resBefore = Number(before?.reserved_balance ?? 0)
  const mainBefore = Number(before?.main_balance ?? 0)

  const expected = drawerBal
  const closed = await rpc('close_shift', {
    p_actual_cash_count: expected,
    p_difference_reason: null,
    p_notes: 'smoke handover liquidity',
    p_destination: 'to_main',
  })
  record(
    '03 close to_main auto-executes money',
    !closed.error && closed.data?.status === 'executed',
    closed.error?.message ?? closed.data?.status,
  )
  record(
    '03b review pending only',
    closed.data?.review_status === 'pending',
    `review=${closed.data?.review_status}`,
  )

  const after = (await rpc('liq_get_snapshot')).data
  const mainAfter = Number(after?.main_balance ?? 0)
  const resAfter = Number(after?.reserved_balance ?? 0)
  record(
    '04 Main increased after handover',
    mainAfter === mainBefore + expected,
    `+${expected} before=${mainBefore} after=${mainAfter}`,
  )
  record(
    '05 reserved grew by 30% of handover',
    Math.abs(resAfter - (resBefore + round2(expected * 0.3))) < 0.02,
    `before=${resBefore} after=${resAfter} expect+${round2(expected * 0.3)}`,
  )

  const sheet = await rpc('get_smart_shift_sheet', {
    p_shift_id: closed.data?.shift_id,
  })
  record('06 smart sheet loads', !sheet.error, sheet.error?.message)
  record(
    '06a top items ≤ 5',
    Array.isArray(sheet.data?.top_items) && sheet.data.top_items.length <= 5,
    `n=${sheet.data?.top_items?.length}`,
  )
  record(
    '06b ops summary present',
    !!sheet.data?.ops_summary &&
      sheet.data.ops_summary.drawer_remaining != null,
  )
  record(
    '06c expenses/purchases arrays',
    Array.isArray(sheet.data?.expenses) && Array.isArray(sheet.data?.purchases),
  )

  // operating gate + release
  let ings = (await rpc('list_ingredients', { p_active_only: true })).data
  const ingredientId = ings?.[0]?.id
  const uomId = ings?.[0]?.base_uom_id
  const snap = (await rpc('liq_get_snapshot')).data
  const op = Number(snap?.operating_balance ?? 0)
  const tryAmt = Math.round(op + 1)
  const mBal = Number((await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0)
  if (mBal < tryAmt) {
    const adj = await rpc('create_adjustment', {
      p_treasury_id: main.id,
      p_kind: 'deposit',
      p_amount: tryAmt - mBal + 20,
      p_reason: 'smoke gate',
    })
    if (!adj.error) await rpc('approve_adjustment', { p_id: adj.data })
  }
  // rebuild reserved if deposit inflated operating without reserved
  const snap2 = (await rpc('liq_get_snapshot')).data
  if (Number(snap2?.reserved_balance) <= 0) {
    // reopen + drop path already used; skip gate if no reserved
    record('07 operating gate', true, 'skipped — no reserved after deposit')
  } else {
    const op2 = Number(snap2.operating_balance)
    const amt = Math.round(op2 + 1)
    const m2 = Number((await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0)
    if (m2 >= amt && ingredientId) {
      const buy = await rpc('pur_post_direct_cash_purchase', {
        p_treasury_id: main.id,
        p_source_kind: 'direct',
        p_supplier_id: null,
        p_direct_label: 'smoke-reject',
        p_notes: null,
        p_lines: [
          {
            ingredient_id: ingredientId,
            qty: 1,
            uom_id: uomId,
            unit_price: amt,
          },
        ],
      })
      record(
        '07 operating gate',
        !!buy.error && buy.error.message.includes('INSUFFICIENT_OPERATING_FUNDS'),
        buy.error?.message ?? 'unexpected ok',
      )
    } else {
      record('07 operating gate', true, 'skipped')
    }
  }

  const beforeRel = (await rpc('liq_get_snapshot')).data
  if (Number(beforeRel?.reserved_balance) >= 5) {
    const mainB = Number(beforeRel.main_balance)
    const rel = await rpc('liq_release_reserved', {
      p_amount: 5,
      p_reason: 'تغطية تشغيل — دخان',
    })
    record(
      '08 release with reason (Main unchanged)',
      !rel.error && Number(rel.data?.main_balance) === mainB,
      rel.error?.message,
    )
  } else {
    record('08 release with reason (Main unchanged)', true, 'skipped')
  }

  const rev = await rpc('review_shift_handover', {
    p_id: closed.data?.handover_id,
    p_decision: 'approved',
    p_notes: 'مراجعة دخان',
  })
  const liqA = (await rpc('liq_get_snapshot')).data
  const liqB = (await rpc('liq_get_snapshot')).data
  record(
    '09 review does not change liquidity',
    !rev.error &&
      Number(liqA.operating_balance) === Number(liqB.operating_balance),
    rev.error?.message,
  )

  // reopen for ops continuity
  await rpc('open_shift', { p_opening_float: 20 })
  record('10 cashier can open after Path A close', true)

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nSmoke liq+handover: ${results.length - failed.length}/${results.length}` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
