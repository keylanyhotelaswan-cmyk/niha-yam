import { createClient } from '@supabase/supabase-js'
import {
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Ops operational purchase capability gate (Testing).
 *
 * Usage: pnpm test:ops-purchase
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
  const managerUser = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')

  const manager = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: mAuth } = await manager.auth.signInWithPassword({
    email: `${managerUser}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (mAuth) {
    console.error('Manager sign-in failed:', mAuth.message)
    process.exit(1)
  }
  console.log('\n[Testing] Operational purchase capability…\n')

  const ctx = await expectOk('01 get_pos_context', manager.rpc('get_pos_context'))
  record(
    '01a manager can_operational_purchase',
    ctx?.can_operational_purchase === true,
    String(ctx?.can_operational_purchase),
  )

  // Cashier without grant denied
  const cashier = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: cAuth } = await cashier.auth.signInWithPassword({
    email: `cashier@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (cAuth) {
    record('02 cashier sign-in', false, cAuth.message)
  } else {
    record('02 cashier sign-in', true)
    const cCtx = await cashier.rpc('get_pos_context')
    record(
      '02a cashier default denied',
      cCtx.data?.can_operational_purchase === false,
      String(cCtx.data?.can_operational_purchase),
    )

    const { data: treasuries } = await manager
      .from('treasuries')
      .select('*')
      .eq('is_active', true)
    const treasury =
      treasuries?.find((t) => t.type === 'cash' && !t.is_shift_drawer) ??
      treasuries?.[0]

    let { data: ings } = await manager.rpc('list_ingredients', {
      p_active_only: true,
    })
    let ingredientId = ings?.[0]?.id
    let uomId = ings?.[0]?.base_uom_id
    if (!ingredientId) {
      const uoms = await manager.rpc('rc_bootstrap_uoms')
      const kg = (uoms.data ?? []).find((u) => u.code === 'kg')
      const created = await manager.rpc('upsert_ingredient', {
        p_id: null,
        p_name_ar: `ops-cap-${Date.now()}`,
        p_name_en: null,
        p_code: null,
        p_base_uom_id: kg.id,
        p_standard_cost: 1,
        p_is_active: true,
      })
      ingredientId = created.data?.id
      uomId = kg.id
    }

    await expectError(
      '03 cashier post denied',
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

    // Grant cashier via update_staff
    const staffList = await expectOk('04 list_staff', manager.rpc('list_staff'))
    const cashierRow = (staffList ?? []).find(
      (s) => (s.username ?? '').toLowerCase() === 'cashier',
    )
    record('04a find cashier', !!cashierRow, cashierRow?.id)

    if (cashierRow) {
      const branchId = cashierRow.branches?.[0]?.branch_id
      const role = cashierRow.branches?.[0]?.role ?? 'cashier'
      await expectOk(
        '05 grant can_operational_purchase',
        manager.rpc('update_staff', {
          p_staff_id: cashierRow.id,
          p_display_name: cashierRow.display_name,
          p_branch_assignments: [{ branch_id: branchId, role }],
          p_discount_permissions: null,
          p_can_operational_purchase: true,
          p_set_operational_purchase: true,
        }),
      )

      // Re-login so JWT/session staff resolution is fresh (same user)
      await cashier.auth.signOut()
      await cashier.auth.signInWithPassword({
        email: `cashier@${INTERNAL_EMAIL_DOMAIN}`,
        password,
      })
      const cCtx2 = await cashier.rpc('get_pos_context')
      record(
        '06 cashier granted',
        cCtx2.data?.can_operational_purchase === true,
        String(cCtx2.data?.can_operational_purchase),
      )

      // Ensure funds on drawer or main for tiny buy
      const payTreasury =
        treasuries?.find((t) => t.is_shift_drawer) ?? treasury
      const balRows = await manager.rpc('get_treasury_balances')
      // deposit if needed via manager
      const adj = await manager.rpc('create_adjustment', {
        p_treasury_id: payTreasury.id,
        p_kind: 'deposit',
        p_amount: 20,
        p_reason: 'ops-purchase test float',
      })
      if (adj.data) await manager.rpc('approve_adjustment', { p_id: adj.data })
      record('07 float for buy', !adj.error, adj.error?.message)

      const posted = await expectOk(
        '08 cashier posts purchase',
        cashier.rpc('pur_post_direct_cash_purchase', {
          p_treasury_id: payTreasury.id,
          p_source_kind: 'direct',
          p_supplier_id: null,
          p_direct_label: 'تشغيل اختبار',
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
      )

      if (posted?.id) {
        await expectOk(
          '09 cashier reverses purchase',
          cashier.rpc('pur_reverse_direct_cash_purchase', {
            p_id: posted.id,
            p_reason: 'عكس اختبار صلاحية',
          }),
        )
      } else {
        record('09 cashier reverses purchase', false, 'no post id')
      }

      // Revoke grant (cleanup)
      await expectOk(
        '10 revoke grant',
        manager.rpc('update_staff', {
          p_staff_id: cashierRow.id,
          p_display_name: cashierRow.display_name,
          p_branch_assignments: [{ branch_id: branchId, role }],
          p_discount_permissions: null,
          p_can_operational_purchase: false,
          p_set_operational_purchase: true,
        }),
      )
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nOps purchase: ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
