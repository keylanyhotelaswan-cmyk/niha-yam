import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * One-off legacy menu import (runs AFTER M3 approval — ADR-0020 / modules.md).
 *
 * Converts the old `ProductCategory` + `Product` exports into the M3 schema,
 * applying default values for every new operational field. Idempotent: re-runs
 * skip rows that already exist (category by name, product by SKU or name).
 *
 * SAFE BY DEFAULT: without `--apply` this is a DRY RUN (reads only, writes
 * nothing) and prints the full report so it can be reviewed before committing.
 *
 * Usage:
 *   node scripts/import-legacy-menu.mjs            # dry run + report
 *   node scripts/import-legacy-menu.mjs --apply    # actually insert
 */

const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'

const CATEGORIES_FILE = resolve('scripts/legacy/ProductCategory_rows.sql')
const PRODUCTS_FILE = resolve('scripts/legacy/Product_rows.sql')

// Operational-field defaults for imported items (ADR-0020). Managers tune later.
const ITEM_DEFAULTS = {
  show_in_pos: true,
  needs_kitchen: true,
  needs_print: true,
  accepts_modifiers: false,
  allows_discounts: true,
  is_favorite: false,
}

// -------------------------------------------------------------------------
// Quote-aware parser for a single `INSERT ... VALUES (...),(...);` statement.
// Handles Arabic text, parentheses inside names, '' escapes, NULL/bool/number.
// -------------------------------------------------------------------------
function extractTuples(sql) {
  const valuesIdx = sql.toUpperCase().indexOf(' VALUES ')
  if (valuesIdx === -1) throw new Error('No VALUES clause found')
  const body = sql.slice(valuesIdx + ' VALUES '.length)

  const tuples = []
  let buf = ''
  let depth = 0
  let inQuote = false

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (inQuote) {
      if (ch === "'") {
        if (body[i + 1] === "'") {
          buf += "'"
          i += 1
        } else {
          inQuote = false
          buf += ch
        }
      } else {
        buf += ch
      }
      continue
    }
    if (ch === "'") {
      inQuote = true
      buf += ch
    } else if (ch === '(') {
      depth += 1
      if (depth === 1) buf = ''
      else buf += ch
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) tuples.push(buf)
      else buf += ch
    } else if (depth > 0) {
      buf += ch
    }
  }
  return tuples
}

function splitFields(tuple) {
  const fields = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < tuple.length; i += 1) {
    const ch = tuple[i]
    if (inQuote) {
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          buf += "'"
          i += 1
        } else {
          inQuote = false
        }
      } else {
        buf += ch
      }
      continue
    }
    if (ch === "'") {
      inQuote = true
    } else if (ch === ',') {
      fields.push(buf.trim())
      buf = ''
    } else {
      buf += ch
    }
  }
  fields.push(buf.trim())
  return fields
}

function coerce(raw) {
  if (raw === undefined) return null
  const lower = raw.toLowerCase()
  if (lower === 'null') return null
  return raw
}

function parseCategories(sql) {
  // (id, branchId, name, createdAt)
  return extractTuples(sql).map((t) => {
    const [id, , name, createdAt] = splitFields(t).map(coerce)
    return { id, name, createdAt }
  })
}

function parseProducts(sql) {
  // (id, branchId, categoryId, name, sku, salePrice, estimatedCost, isAvailable, createdAt)
  return extractTuples(sql).map((t) => {
    const f = splitFields(t)
    return {
      id: coerce(f[0]),
      categoryId: coerce(f[2]),
      name: coerce(f[3]),
      sku: coerce(f[4]),
      salePrice: coerce(f[5]),
      isAvailable: coerce(f[7]) === 'true',
    }
  })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

  assertSupabaseUrl(url)
  if (!serviceKey)
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY in .env.local')

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const legacyCategories = parseCategories(
    readFileSync(CATEGORIES_FILE, 'utf8'),
  )
  const legacyProducts = parseProducts(readFileSync(PRODUCTS_FILE, 'utf8'))

  console.log(`\nMode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`)
  console.log(
    `Parsed: ${legacyCategories.length} categories, ${legacyProducts.length} products\n`,
  )

  // Existing state (idempotency) --------------------------------------------
  const { data: existingCats, error: catErr } = await admin
    .from('menu_categories')
    .select('id, name')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
  if (catErr) throw catErr

  const { data: existingItems, error: itemErr } = await admin
    .from('menu_items')
    .select('id, name, sku')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
  if (itemErr) throw itemErr

  const catByName = new Map((existingCats ?? []).map((c) => [c.name, c.id]))
  const existingSkus = new Set(
    (existingItems ?? []).filter((i) => i.sku).map((i) => i.sku.toLowerCase()),
  )
  const existingItemNames = new Set((existingItems ?? []).map((i) => i.name))

  const report = {
    categoriesCreated: [],
    categoriesSkipped: [],
    itemsCreated: [],
    itemsSkippedExisting: [],
    itemsSkippedNoCategory: [],
    itemsModified: [],
  }

  // Categories --------------------------------------------------------------
  const legacyCatIdToNewId = new Map()
  const sortedCats = [...legacyCategories].sort((a, b) =>
    (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
  )

  let catSort = 0
  for (const cat of sortedCats) {
    const name = (cat.name ?? '').trim()
    if (catByName.has(name)) {
      legacyCatIdToNewId.set(cat.id, catByName.get(name))
      report.categoriesSkipped.push(name)
      continue
    }
    const newId = randomUUID()
    legacyCatIdToNewId.set(cat.id, newId)
    catByName.set(name, newId)
    report.categoriesCreated.push({ name, sort_order: catSort })

    if (apply) {
      const { error } = await admin.from('menu_categories').insert({
        id: newId,
        restaurant_id: SEED_RESTAURANT_ID,
        name,
        sort_order: catSort,
        show_in_pos: true,
        is_active: true,
      })
      if (error) throw new Error(`category "${name}": ${error.message}`)
    }
    catSort += 10
  }

  // Products ----------------------------------------------------------------
  const seenSkus = new Set()
  // sort_order per category, in legacy order.
  const perCategorySort = new Map()

  for (const p of legacyProducts) {
    const name = (p.name ?? '').trim()
    const newCategoryId = legacyCatIdToNewId.get(p.categoryId) ?? null

    if (!newCategoryId) {
      report.itemsSkippedNoCategory.push(name)
      continue
    }

    let sku = p.sku ? p.sku.trim() : null
    const notes = []

    // S5: SKU must be unique. Clear duplicates (existing or within this run).
    if (sku) {
      const key = sku.toLowerCase()
      if (existingSkus.has(key) || seenSkus.has(key)) {
        notes.push(`duplicate SKU "${sku}" cleared`)
        sku = null
      } else {
        seenSkus.add(key)
      }
    }

    // Idempotency: skip if a same-named item already exists (with no new SKU).
    if (existingItemNames.has(name) && !sku) {
      report.itemsSkippedExisting.push(name)
      continue
    }
    if (sku && existingSkus.has(sku.toLowerCase())) {
      report.itemsSkippedExisting.push(name)
      continue
    }

    const basePrice = Number.parseFloat(p.salePrice ?? '0') || 0
    const isOpenPrice = (p.sku ?? '').trim().toUpperCase() === 'POS-CUSTOM'
    if (isOpenPrice) notes.push('open price (S1)')

    const sortIdx = perCategorySort.get(newCategoryId) ?? 0
    perCategorySort.set(newCategoryId, sortIdx + 10)

    report.itemsCreated.push({ name, sku, basePrice })
    if (notes.length > 0) report.itemsModified.push({ name, notes })

    if (apply) {
      const { error } = await admin.from('menu_items').insert({
        restaurant_id: SEED_RESTAURANT_ID,
        category_id: newCategoryId,
        name,
        sku,
        base_price: basePrice,
        sort_order: sortIdx,
        is_open_price: isOpenPrice,
        is_active: p.isAvailable,
        ...ITEM_DEFAULTS,
      })
      if (error) throw new Error(`item "${name}": ${error.message}`)
    }
  }

  // Report ------------------------------------------------------------------
  const line = (label, n) => console.log(`  ${label.padEnd(28)} ${n}`)
  console.log('=== Import report ===')
  line('Categories created:', report.categoriesCreated.length)
  line('Categories skipped (exist):', report.categoriesSkipped.length)
  line('Items created:', report.itemsCreated.length)
  line('Items skipped (exist):', report.itemsSkippedExisting.length)
  line('Items skipped (no category):', report.itemsSkippedNoCategory.length)
  line('Items modified (notes):', report.itemsModified.length)

  if (report.itemsModified.length > 0) {
    console.log('\n  Modified items:')
    for (const m of report.itemsModified) {
      console.log(`    - ${m.name}: ${m.notes.join('; ')}`)
    }
  }
  if (report.itemsSkippedNoCategory.length > 0) {
    console.log('\n  Skipped (no category):')
    for (const n of report.itemsSkippedNoCategory) console.log(`    - ${n}`)
  }
  if (report.itemsSkippedExisting.length > 0) {
    console.log('\n  Skipped (already exist):')
    for (const n of report.itemsSkippedExisting) console.log(`    - ${n}`)
  }

  console.log(
    apply
      ? '\nOK: import applied.'
      : '\nDRY RUN complete — re-run with --apply to write.',
  )
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
