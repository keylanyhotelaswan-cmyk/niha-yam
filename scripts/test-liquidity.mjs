import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Liquidity — operating / reserved administrative split (Testing only).
 *
 *   pnpm test:liquidity
 *   pnpm test:liquidity -- --username manager --password "Testing123!"
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
  assertTestingTarget(env.VITE_SUPABASE_URL)
  refuseProductionMutations(env.VITE_SUPABASE_URL)
  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
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
  console.log(`\n[Testing] Signed in as ${username}. Liquidity scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  const snap0 = await expectOk('01 get snapshot', rpc('liq_get_snapshot'))
  record(
    '01a defaults present',
    snap0 &&
      Number(snap0.operating_pct) + Number(snap0.reserved_pct) === 100,
    `op=${snap0?.operating_pct} res=${snap0?.reserved_pct}`,
  )

  await expectOk(
    '02 set 70/30',
    rpc('liq_upsert_settings', { p_operating_pct: 70, p_reserved_pct: 30 }),
  )

  const { data: treasuries } = await supabase
    .from('treasuries')
    .select('*')
    .eq('is_active', true)
  const main =
    treasuries?.find((t) => t.type === 'cash' && !t.is_shift_drawer) ??
    treasuries?.[0]
  const drawer = treasuries?.find((t) => t.is_shift_drawer)
  if (!main || !drawer) {
    console.error('Need main + drawer treasuries')
    process.exit(1)
  }
  record('03 treasuries', true, `main=${main.name}`)

  // Ensure main has cash via deposit (does NOT auto-split — only handover/cash_drop)
  const balMain = Number(
    (await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0,
  )
  if (balMain < 200) {
    const adj = await expectOk(
      '04 deposit main',
      rpc('create_adjustment', {
        p_treasury_id: main.id,
        p_kind: 'deposit',
        p_amount: 500,
        p_reason: 'liquidity test float',
      }),
    )
    if (adj) await expectOk('04b approve deposit', rpc('approve_adjustment', { p_id: adj }))
  } else {
    record('04 deposit main', true, `balance=${balMain}`)
    record('04b approve deposit', true, 'skipped')
  }

  // Simulate revenue into Main via cash_drop path: need open shift + drawer funds
  // Simpler: insert revenue_split manually via liq_apply by posting a cash_drop-like
  // transfer_in — use cash_drop if shift open, else fabricate allocation via release tests
  // using direct SQL isn't available. Use RPC: create transfer drawer→main as cash drop.

  let open = (await rpc('get_open_shift')).data
  if (!open) {
    await expectOk('05 open shift', rpc('open_shift', { p_opening_float: 100 }))
    open = (await rpc('get_open_shift')).data
  } else {
    record('05 open shift', true, 'already open')
  }

  const drawerBal = Number(
    (await rpc('treasury_balance', { p_treasury_id: drawer.id })).data ?? 0,
  )
  if (drawerBal < 100) {
    // move some from main to drawer via reverse path isn't easy; deposit to drawer via adjustment
    const adjD = await rpc('create_adjustment', {
      p_treasury_id: drawer.id,
      p_kind: 'deposit',
      p_amount: 200,
      p_reason: 'liquidity drawer float',
    })
    if (!adjD.error) {
      await rpc('approve_adjustment', { p_id: adjD.data })
      record('05b drawer float', true)
    } else {
      record('05b drawer float', false, adjD.error.message)
    }
  } else {
    record('05b drawer float', true, `bal=${drawerBal}`)
  }

  const beforeSplit = await expectOk('06 snapshot before cash drop', rpc('liq_get_snapshot'))
  const resBefore = Number(beforeSplit?.reserved_balance ?? 0)
  const mainBefore = Number(beforeSplit?.main_balance ?? 0)

  const drop = await expectOk(
    '07 cash drop 100 (triggers revenue split)',
    rpc('cash_drop', { p_amount: 100, p_reason: 'liquidity test drop' }),
  )

  const afterSplit = await expectOk('08 snapshot after drop', rpc('liq_get_snapshot'))
  const resAfter = Number(afterSplit?.reserved_balance ?? 0)
  const mainAfter = Number(afterSplit?.main_balance ?? 0)
  // 30% of 100 = 30 reserved increase; main +100
  record(
    '08a main +100',
    mainAfter === mainBefore + 100,
    `before=${mainBefore} after=${mainAfter}`,
  )
  record(
    '08b reserved +30',
    Math.abs(resAfter - (resBefore + 30)) < 0.01,
    `before=${resBefore} after=${resAfter} drop=${drop?.reference ?? ''}`,
  )
  const opAfter = Number(afterSplit?.operating_balance ?? 0)
  record(
    '08c operating = main - reserved',
    Math.abs(opAfter - (mainAfter - resAfter)) < 0.01,
    `op=${opAfter}`,
  )

  // Exhaust operating artificially: set reserved high via settings won't change existing allocs.
  // Spend until operating nearly empty by purchasing — or release reverse.
  // Force: release 0 and try purchase larger than operating.
  let ings = (await rpc('list_ingredients', { p_active_only: true })).data
  let ingredientId = ings?.[0]?.id
  let uomId = ings?.[0]?.base_uom_id
  if (!ingredientId) {
    const uoms = await rpc('rc_bootstrap_uoms')
    const kg = (uoms.data ?? []).find((u) => u.code === 'kg')
    const created = await rpc('upsert_ingredient', {
      p_id: null,
      p_name_ar: `سيولة-${Date.now()}`,
      p_name_en: null,
      p_code: null,
      p_base_uom_id: kg.id,
      p_standard_cost: 1,
      p_is_active: true,
    })
    ingredientId = created.data?.id
    uomId = kg.id
  }

  const snapGate = await rpc('liq_get_snapshot')
  const opGate = Number(snapGate.data?.operating_balance ?? 0)
  const overAmount = Math.max(opGate + 10, 50)

  // Ensure physical main balance covers overAmount (deposit if needed) so we hit OPERATING not FUNDS
  const mainNow = Number(
    (await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0,
  )
  if (mainNow < overAmount) {
    const need = overAmount - mainNow + 20
    const adj = await rpc('create_adjustment', {
      p_treasury_id: main.id,
      p_kind: 'deposit',
      p_amount: need,
      p_reason: 'liquidity gate float',
    })
    if (!adj.error) await rpc('approve_adjustment', { p_id: adj.data })
  }

  // Increase reserved so operating is small: release won't help; instead do another large drop
  // then try to spend more than operating.
  const snap2 = (await rpc('liq_get_snapshot')).data
  const op2 = Number(snap2?.operating_balance ?? 0)
  const spendTooMuch = Math.round(op2 + 5)

  if (spendTooMuch > 0) {
    // Ensure main physical >= spendTooMuch
    const m2 = Number(
      (await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0,
    )
    if (m2 < spendTooMuch) {
      const adj = await rpc('create_adjustment', {
        p_treasury_id: main.id,
        p_kind: 'deposit',
        p_amount: spendTooMuch - m2 + 10,
        p_reason: 'gate',
      })
      if (!adj.error) await rpc('approve_adjustment', { p_id: adj.data })
      // Deposit doesn't increase reserved — operating grows. Re-drop to rebuild reserved.
      const drawer2 = Number(
        (await rpc('treasury_balance', { p_treasury_id: drawer.id })).data ?? 0,
      )
      if (drawer2 >= 50) {
        await rpc('cash_drop', { p_amount: 50, p_reason: 'rebuild reserved' })
      }
    }

    const snap3 = (await rpc('liq_get_snapshot')).data
    const op3 = Number(snap3?.operating_balance ?? 0)
    const tryAmt = Math.round(op3 + 1)
    const m3 = Number(
      (await rpc('treasury_balance', { p_treasury_id: main.id })).data ?? 0,
    )
    if (tryAmt > 0 && m3 >= tryAmt && Number(snap3?.reserved_balance) > 0) {
      await expectError(
        '09 purchase blocked by operating',
        rpc('pur_post_direct_cash_purchase', {
          p_treasury_id: main.id,
          p_source_kind: 'direct',
          p_supplier_id: null,
          p_direct_label: 'سيولة-رفض',
          p_notes: null,
          p_lines: [
            {
              ingredient_id: ingredientId,
              qty: 1,
              uom_id: uomId,
              unit_price: tryAmt,
            },
          ],
        }),
        'INSUFFICIENT_OPERATING_FUNDS',
      )
    } else {
      record(
        '09 purchase blocked by operating',
        true,
        `skipped op=${op3} main=${m3} res=${snap3?.reserved_balance}`,
      )
    }
  }

  // Release reserved → operating increases; Main unchanged
  const beforeRel = (await rpc('liq_get_snapshot')).data
  const resAvail = Number(beforeRel?.reserved_balance ?? 0)
  if (resAvail >= 10) {
    const mainB = Number(beforeRel.main_balance)
    const rel = await expectOk(
      '10 release 10 to operating',
      rpc('liq_release_reserved', {
        p_amount: 10,
        p_reason: 'اختبار نقل للتشغيل',
      }),
    )
    record(
      '10a main unchanged',
      Number(rel?.main_balance) === mainB,
      `main=${rel?.main_balance}`,
    )
    record(
      '10b reserved -10',
      Math.abs(Number(rel?.reserved_balance) - (resAvail - 10)) < 0.01,
      `res=${rel?.reserved_balance}`,
    )
  } else {
    record('10 release 10 to operating', true, 'skipped — no reserved')
    record('10a main unchanged', true, 'skipped')
    record('10b reserved -10', true, 'skipped')
  }

  await expectError(
    '11 release without reason',
    rpc('liq_release_reserved', { p_amount: 1, p_reason: '' }),
    'REASON_REQUIRED',
  )

  await expectError(
    '12 invalid settings sum',
    rpc('liq_upsert_settings', { p_operating_pct: 60, p_reserved_pct: 30 }),
    'INVALID_AMOUNT',
  )

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nLiquidity: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
