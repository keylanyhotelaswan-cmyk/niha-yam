import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * RCA — Recipes & Costing (standard cost, UoM, waste/yield, coverage).
 *
 * Usage:
 *   pnpm test:recipes -- --username abomalek --password "SECRET"
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
    if (String(e.message).includes(code))
      record(name, true, `rejected: ${code}`)
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
  console.log(`\nSigned in as ${username}. Running RCA Recipes scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)

  const uomsBoot = await expectOk('01 rc_bootstrap_uoms', rpc('rc_bootstrap_uoms'))
  const uoms =
    uomsBoot ??
    (await expectOk('01b list_uoms', rpc('list_uoms')))
  record('01a seeded uoms', Array.isArray(uoms) && uoms.length >= 4, `n=${uoms?.length}`)
  const kg = uoms?.find((u) => u.code === 'kg')
  const g = uoms?.find((u) => u.code === 'g')
  const portion = uoms?.find((u) => u.code === 'portion')

  const coverage = await expectOk(
    '02 recipes_coverage_dashboard',
    rpc('recipes_coverage_dashboard'),
  )
  record(
    '02a coverage shape',
    coverage != null &&
      typeof coverage.menu_items_total === 'number' &&
      typeof coverage.with_recipe === 'number' &&
      typeof coverage.without_recipe === 'number',
  )

  if (!kg || !g || !portion) {
    record('03 upsert_ingredient', false, 'missing uoms')
  } else {
    const ing = await expectOk(
      '03 upsert_ingredient',
      rpc('upsert_ingredient', {
        p_id: null,
        p_name_ar: `اختبار-مكون-${Date.now()}`,
        p_name_en: 'test-ing',
        p_code: `T${Date.now().toString().slice(-6)}`,
        p_base_uom_id: kg.id,
        p_standard_cost: 100,
        p_is_active: true,
      }),
    )
    const ingredientId = ing?.id
    record('03a ingredient id', !!ingredientId)

    const recipe = await expectOk(
      '04 upsert_recipe prep',
      rpc('upsert_recipe', {
        p_id: null,
        p_menu_item_id: null,
        p_name_ar: `تحضير-اختبار-${Date.now()}`,
        p_name_en: null,
        p_yield_qty: 10,
        p_yield_uom_id: portion.id,
        p_waste_pct: 10,
        p_is_active: true,
        p_lines: [
          {
            ingredient_id: ingredientId,
            qty: 1,
            uom_id: kg.id,
            sort_order: 1,
          },
        ],
      }),
    )
    const recipeId = recipe?.id
    record('04a recipe id', !!recipeId)

    const cost = await expectOk(
      '05 compute_recipe_cost',
      rpc('compute_recipe_cost', { p_recipe_id: recipeId }),
    )
    // 1kg * 100 = 100 ingredients; waste 10% → 110 batch; /10 yield → 11 unit
    const okMath =
      cost != null &&
      Number(cost.ingredients_cost) === 100 &&
      Number(cost.total_batch_cost) === 110 &&
      Number(cost.cost_per_yield_unit) === 11
    record(
      '05a waste/yield math',
      okMath,
      `ing=${cost?.ingredients_cost} batch=${cost?.total_batch_cost} unit=${cost?.cost_per_yield_unit}`,
    )
    record(
      '05b breakdown lines',
      Array.isArray(cost?.lines) && cost.lines.length === 1,
    )

    // Missing conversion: use ml without linking to kg → should fail if we use wrong uom
    // Create ingredient in kg, line in ml without kg↔ml → MISSING_UOM_CONVERSION
    const ml = uoms.find((u) => u.code === 'ml')
    if (ml && ingredientId) {
      const bad = await expectOk(
        '06 upsert bad-uom recipe (setup)',
        rpc('upsert_recipe', {
          p_id: null,
          p_menu_item_id: null,
          p_name_ar: `سيئ-وحدة-${Date.now()}`,
          p_name_en: null,
          p_yield_qty: 1,
          p_yield_uom_id: portion.id,
          p_waste_pct: 0,
          p_is_active: true,
          p_lines: [
            { ingredient_id: ingredientId, qty: 100, uom_id: ml.id, sort_order: 1 },
          ],
        }),
      )
      if (bad?.id) {
        await expectError(
          '06a missing conversion on cost',
          rpc('compute_recipe_cost', { p_recipe_id: bad.id }),
          'MISSING_UOM_CONVERSION',
        )
      } else {
        record('06a missing conversion on cost', false, 'setup failed')
      }
    } else {
      record('06 upsert bad-uom recipe (setup)', true, 'skipped')
      record('06a missing conversion on cost', true, 'skipped')
    }

    // g→kg conversion path: 1000g of 100/kg = 100 cost
    const recipeG = await expectOk(
      '07 recipe with g line',
      rpc('upsert_recipe', {
        p_id: null,
        p_menu_item_id: null,
        p_name_ar: `تحويل-جم-${Date.now()}`,
        p_name_en: null,
        p_yield_qty: 1,
        p_yield_uom_id: portion.id,
        p_waste_pct: 0,
        p_is_active: true,
        p_lines: [
          { ingredient_id: ingredientId, qty: 1000, uom_id: g.id, sort_order: 1 },
        ],
      }),
    )
    const costG = await expectOk(
      '07a cost via g→kg',
      rpc('compute_recipe_cost', { p_recipe_id: recipeG?.id }),
    )
    record(
      '07b conversion math',
      Number(costG?.ingredients_cost) === 100,
      `cost=${costG?.ingredients_cost}`,
    )
  }

  const items = await expectOk(
    '08 list_menu_items_recipe_status',
    rpc('list_menu_items_recipe_status'),
  )
  record('08a status array', Array.isArray(items))

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n==== RCA Recipes review: ${passed} passed, ${failed} failed ====\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
