import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * INVA — Inventory movements, Stock Card, dashboard (qty only).
 *
 * Usage:
 *   pnpm test:inventory -- --username abomalek --password "SECRET"
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
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
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
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running INVA scenarios…\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)

  const locs = await expectOk('01 inv_list_locations', rpc('inv_list_locations'))
  record(
    '01a default location',
    Array.isArray(locs) && locs.some((l) => l.is_default),
    `n=${locs?.length}`,
  )

  const dash = await expectOk('02 inv_dashboard', rpc('inv_dashboard'))
  record(
    '02a dashboard shape',
    dash != null &&
      typeof dash.ingredients_total === 'number' &&
      Array.isArray(dash.recent_movements) &&
      Array.isArray(dash.top_waste) &&
      dash.signals != null,
  )

  const ings = await expectOk('03 list_ingredients', rpc('list_ingredients', { p_active_only: true }))
  let ingredientId = ings?.[0]?.id
  let uomId = ings?.[0]?.base_uom_id

  if (!ingredientId) {
    const uoms = await rpc('rc_bootstrap_uoms')
    const kg = (uoms.data ?? []).find((u) => u.code === 'kg')
    const created = await expectOk(
      '03b create ingredient',
      rpc('upsert_ingredient', {
        p_id: null,
        p_name_ar: `مخزون-اختبار-${Date.now()}`,
        p_name_en: null,
        p_code: null,
        p_base_uom_id: kg.id,
        p_standard_cost: 1,
        p_is_active: true,
      }),
    )
    ingredientId = created?.id
    uomId = kg.id
  } else {
    record('03b create ingredient', true, 'reused existing')
  }

  const open = await expectOk(
    '04 opening movement',
    rpc('inv_post_movement', {
      p_ingredient_id: ingredientId,
      p_movement_type: 'opening',
      p_qty: 100,
      p_uom_id: uomId,
      p_location_id: null,
      p_reason: null,
      p_lot_id: null,
      p_source_type: null,
      p_source_id: null,
      p_direction: null,
      p_reference: null,
    }),
  )
  record('04a opening ref', !!open?.reference, open?.reference)

  const waste = await expectOk(
    '05 waste movement',
    rpc('inv_post_movement', {
      p_ingredient_id: ingredientId,
      p_movement_type: 'waste',
      p_qty: 5,
      p_uom_id: uomId,
      p_location_id: null,
      p_reason: 'اختبار هالك',
      p_lot_id: null,
      p_source_type: null,
      p_source_id: null,
      p_direction: null,
      p_reference: null,
    }),
  )

  const card = await expectOk(
    '06 stock card',
    rpc('inv_get_stock_card', {
      p_ingredient_id: ingredientId,
      p_location_id: null,
      p_limit: 50,
    }),
  )
  record(
    '06a on_hand 95',
    Number(card?.on_hand) === 95,
    `on_hand=${card?.on_hand}`,
  )
  record(
    '06b card rows have actor fields',
    Array.isArray(card?.rows) &&
      card.rows.length >= 2 &&
      card.rows.some((r) => r.reference && r.balance_after != null),
  )

  await expectError(
    '07 waste without reason',
    rpc('inv_post_movement', {
      p_ingredient_id: ingredientId,
      p_movement_type: 'waste',
      p_qty: 1,
      p_uom_id: uomId,
      p_location_id: null,
      p_reason: null,
      p_lot_id: null,
      p_source_type: null,
      p_source_id: null,
      p_direction: null,
      p_reference: null,
    }),
    'REASON_REQUIRED',
  )

  const rev = await expectOk(
    '08 reverse waste',
    rpc('inv_reverse_movement', {
      p_movement_id: waste?.id,
      p_reason: 'عكس اختبار',
    }),
  )
  record('08a reverse linked', rev?.reverses_movement_id === waste?.id)

  const card2 = await expectOk(
    '09 card after reverse',
    rpc('inv_get_stock_card', {
      p_ingredient_id: ingredientId,
      p_location_id: null,
      p_limit: 50,
    }),
  )
  record('09a on_hand back to 100', Number(card2?.on_hand) === 100, `on_hand=${card2?.on_hand}`)

  await expectError(
    '10 double reverse rejected',
    rpc('inv_reverse_movement', { p_movement_id: waste?.id, p_reason: 'x' }),
    'ALREADY_REVERSED',
  )

  // Negative warning: issue 200 from 100
  const big = await expectOk(
    '11 over-issue allows negative',
    rpc('inv_post_movement', {
      p_ingredient_id: ingredientId,
      p_movement_type: 'issue',
      p_qty: 200,
      p_uom_id: uomId,
      p_location_id: null,
      p_reason: null,
      p_lot_id: null,
      p_source_type: null,
      p_source_id: null,
      p_direction: null,
      p_reference: null,
    }),
  )
  record(
    '11a negative warning',
    big?.negative_stock_warning === true,
    `on_hand_after=${big?.on_hand_after}`,
  )

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== INVA review: ${passed} passed, ${failed} failed ====\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
