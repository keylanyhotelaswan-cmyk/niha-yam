/**
 * Seed the Testing Supabase project with demo masters (no production data).
 *
 * HARD RULE: never seeds Production. assertTestingTarget() aborts if the URL
 * is not the Testing project. Structural schema comes from migrations only.
 *
 * Idempotent where practical. Wipes auth staff on --reset then re-seeds.
 *
 * Usage:
 *   pnpm seed:testing
 *   pnpm seed:testing -- --reset
 */
import { createClient } from '@supabase/supabase-js'
import {
  TESTING_SUPABASE_REF,
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'

const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'
const SEED_BRANCH_ID = 'b0000000-0000-4000-8000-000000000001'
const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

const hasFlag = (name) => process.argv.includes(name)

function emailFor(username) {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`
}

async function deleteAllStaff(admin) {
  const { data: existing, error } = await admin.from('staff').select('user_id')
  if (error) throw new Error(`list staff: ${error.message}`)
  for (const row of existing ?? []) {
    const { error: delError } = await admin.auth.admin.deleteUser(row.user_id)
    if (delError) throw new Error(`delete user: ${delError.message}`)
  }
  console.log(`  reset: removed ${(existing ?? []).length} staff auth user(s)`)
}

async function ensureAuthUser(admin, { username, password, displayName }) {
  const email = emailFor(username)
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 })
  const found = (listed?.users ?? []).find(
    (u) =>
      u.email?.toLowerCase() === email ||
      u.user_metadata?.username === username,
  )
  if (found) {
    await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
      user_metadata: { username, display_name: displayName },
    })
    return found.id
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  })
  if (error || !data.user) {
    throw new Error(`createUser ${username}: ${error?.message ?? 'unknown'}`)
  }
  return data.user.id
}

async function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)

  console.log('NOTE: Seed is Testing-only — Production data will not be touched.')

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY missing in .env.testing')
    process.exit(1)
  }

  const managerUsername = env.TESTING_MANAGER_USERNAME || 'manager'
  const managerPassword = env.TESTING_MANAGER_PASSWORD || 'Testing123!'
  const managerPin = env.TESTING_MANAGER_PIN || '1111'
  const cashierUsername = env.TESTING_CASHIER_USERNAME || 'cashier'
  const cashierPassword = env.TESTING_CASHIER_PASSWORD || 'Testing123!'
  const cashierPin = env.TESTING_CASHIER_PIN || '2222'

  const url = env.VITE_SUPABASE_URL.replace(/\/$/, '')
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`Seeding Testing project ${TESTING_SUPABASE_REF}…`)

  if (hasFlag('--reset')) {
    await deleteAllStaff(admin)
  }

  // Structural seed restaurant comes from migrations; rename for clarity.
  const { error: restErr } = await admin
    .from('restaurants')
    .update({
      name: 'NIHA Testing Restaurant',
      currency_code: 'EGP',
      timezone: 'Africa/Cairo',
    })
    .eq('id', SEED_RESTAURANT_ID)
  if (restErr) {
    console.error(
      'FAIL: restaurant update — did you run pnpm migrate:testing?',
      restErr.message,
    )
    process.exit(1)
  }

  const { error: branchErr } = await admin
    .from('branches')
    .update({ name: 'فرع الاختبار' })
    .eq('id', SEED_BRANCH_ID)
  if (branchErr) console.warn('  warn branch:', branchErr.message)

  // Manager (owner) via bootstrap RPC when no staff yet.
  const { count: staffCount } = await admin
    .from('staff')
    .select('id', { count: 'exact', head: true })

  const managerUserId = await ensureAuthUser(admin, {
    username: managerUsername,
    password: managerPassword,
    displayName: 'مدير الاختبار',
  })

  if (!staffCount) {
    const { data: staffId, error: bootErr } = await admin.rpc(
      'bootstrap_owner_staff',
      {
        p_user_id: managerUserId,
        p_username: managerUsername,
        p_display_name: 'مدير الاختبار',
        p_restaurant_id: SEED_RESTAURANT_ID,
        p_branch_id: SEED_BRANCH_ID,
      },
    )
    if (bootErr) {
      console.error('FAIL: bootstrap_owner_staff:', bootErr.message)
      process.exit(1)
    }
    console.log('  manager staff_id:', staffId)
  } else {
    console.log('  manager: staff already present (skip bootstrap)')
  }

  // Sign in as manager for RPCs (menu, customers, shift, pin, provision).
  const userClient = createClient(url, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: loginErr } = await userClient.auth.signInWithPassword({
    email: emailFor(managerUsername),
    password: managerPassword,
  })
  if (loginErr) {
    console.error('FAIL: manager login:', loginErr.message)
    process.exit(1)
  }

  // Manager PIN
  {
    const { data: me } = await userClient
      .from('staff')
      .select('id')
      .eq('username', managerUsername)
      .maybeSingle()
    if (me?.id) {
      const { error } = await userClient.rpc('set_staff_pin', {
        p_staff_id: me.id,
        p_pin: managerPin,
      })
      if (error) console.warn('  warn manager pin:', error.message)
      else console.log('  manager PIN set')
    }
  }

  // Cashier auth + provision_staff
  const cashierUserId = await ensureAuthUser(admin, {
    username: cashierUsername,
    password: cashierPassword,
    displayName: 'كاشير الاختبار',
  })

  const { data: existingCashier } = await admin
    .from('staff')
    .select('id')
    .eq('username', cashierUsername)
    .maybeSingle()

  if (!existingCashier) {
    const { data: actor } = await admin
      .from('staff')
      .select('user_id')
      .eq('username', managerUsername)
      .single()

    const { data: cashierStaffId, error: provErr } = await admin.rpc(
      'provision_staff',
      {
        p_actor_user_id: actor.user_id,
        p_user_id: cashierUserId,
        p_username: cashierUsername,
        p_display_name: 'كاشير الاختبار',
        p_role: 'cashier',
        p_is_active: true,
        p_pin: cashierPin,
        p_email: null,
      },
    )
    if (provErr) {
      console.error('FAIL: provision_staff cashier:', provErr.message)
      process.exit(1)
    }
    console.log('  cashier staff_id:', cashierStaffId)
  } else {
    const { error } = await userClient.rpc('set_staff_pin', {
      p_staff_id: existingCashier.id,
      p_pin: cashierPin,
    })
    if (error) console.warn('  warn cashier pin:', error.message)
    else console.log('  cashier already exists; PIN refreshed')
  }

  // Menu — find-or-create categories
  async function ensureCategory(name, sortOrder) {
    const { data: existing } = await admin
      .from('menu_categories')
      .select('id')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .eq('name', name)
      .maybeSingle()
    if (existing?.id) return existing.id

    const { data: id, error } = await userClient.rpc('upsert_menu_category', {
      p_id: null,
      p_name: name,
      p_sort_order: sortOrder,
      p_show_in_pos: true,
      p_is_active: true,
    })
    if (error) throw new Error(`category ${name}: ${error.message}`)
    console.log(`  category: ${name}`)
    return id
  }

  const categoryId = await ensureCategory('مشروبات', 0)
  const foodCategoryId = await ensureCategory('أطباق', 10)

  const items = [
    {
      category: categoryId,
      name: 'شاي',
      sku: 'TEA',
      price: 10,
      kitchen: false,
      favorite: true,
    },
    {
      category: categoryId,
      name: 'قهوة',
      sku: 'COF',
      price: 20,
      kitchen: false,
      favorite: true,
    },
    {
      category: foodCategoryId,
      name: 'سندوتش جبنة',
      sku: 'CHS',
      price: 35,
      kitchen: true,
      favorite: true,
    },
    {
      category: foodCategoryId,
      name: 'وجبة دجاج',
      sku: 'CHK',
      price: 85,
      kitchen: true,
      favorite: false,
    },
  ]

  for (const item of items) {
    const { data: existingItem } = await admin
      .from('menu_items')
      .select('id')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .eq('sku', item.sku)
      .maybeSingle()
    if (existingItem?.id) continue

    const { error: itemErr } = await userClient.rpc('upsert_menu_item', {
      p_id: null,
      p_category_id: item.category,
      p_name: item.name,
      p_sku: item.sku,
      p_base_price: item.price,
      p_sort_order: 0,
      p_show_in_pos: true,
      p_needs_kitchen: item.kitchen,
      p_needs_print: true,
      p_accepts_modifiers: false,
      p_allows_discounts: true,
      p_is_open_price: false,
      p_is_favorite: item.favorite,
      p_description: null,
    })
    if (itemErr) console.warn(`  warn item ${item.sku}:`, itemErr.message)
    else console.log(`  item: ${item.name}`)
  }

  // Customers
  for (const c of [
    {
      name: 'عميل تجريبي',
      phone: '01000000001',
      address: 'شارع الاختبار 1',
      zone: 'المنطقة أ',
    },
    {
      name: 'عميل دليفري',
      phone: '01000000002',
      address: 'شارع الاختبار 2',
      zone: 'المنطقة ب',
    },
  ]) {
    const { error } = await userClient.rpc('upsert_customer', {
      p_display_name: c.name,
      p_phone: c.phone,
      p_notes: 'seed testing',
      p_address: c.address,
      p_delivery_zone: c.zone,
    })
    if (error && !/duplicate|UNIQUE/i.test(error.message)) {
      console.warn('  warn customer:', error.message)
    } else {
      console.log(`  customer: ${c.name}`)
    }
  }

  // Print bridge (POS device stand-in)
  const { data: bridges } = await admin
    .from('print_bridges')
    .select('id')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .limit(1)
  if (!bridges?.length) {
    const { error } = await admin.from('print_bridges').insert({
      restaurant_id: SEED_RESTAURANT_ID,
      display_name: 'جهاز POS اختبار',
      device_name: 'TESTING-POS-01',
      windows_username: 'tester',
      version: 'testing',
      is_active: true,
      last_heartbeat_at: new Date().toISOString(),
    })
    if (error) console.warn('  warn bridge:', error.message)
    else console.log('  print bridge / POS device seeded')
  } else {
    console.log('  print bridge already present')
  }

  // Ensure printers have a windows name for local spooler tests
  await admin
    .from('printers')
    .update({
      address: { windows_printer_name: 'Testing Receipt Printer' },
    })
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .eq('role', 'cashier')
  await admin
    .from('printers')
    .update({
      address: { windows_printer_name: 'Testing Kitchen Printer' },
    })
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .eq('role', 'kitchen')

  // Open shift if none
  const { data: openShift } = await admin
    .from('shifts')
    .select('id, reference')
    .eq('restaurant_id', SEED_RESTAURANT_ID)
    .eq('status', 'open')
    .maybeSingle()

  if (!openShift) {
    const { data: shiftId, error: shiftErr } = await userClient.rpc(
      'open_shift',
      {
        p_opening_float: 500,
        p_receive_handover_id: null,
      },
    )
    if (shiftErr) console.warn('  warn open_shift:', shiftErr.message)
    else console.log('  open shift:', shiftId)
  } else {
    console.log('  open shift already:', openShift.reference)
  }

  // Verify treasuries + payment methods from migration seeds
  const { count: treasuryCount } = await admin
    .from('treasuries')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', SEED_RESTAURANT_ID)
  const { count: pmCount } = await admin
    .from('payment_methods')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', SEED_RESTAURANT_ID)

  console.log('')
  console.log('OK: Testing seed complete')
  console.log(`  restaurant: NIHA Testing Restaurant (${SEED_RESTAURANT_ID})`)
  console.log(`  treasuries: ${treasuryCount ?? 0}`)
  console.log(`  payment methods: ${pmCount ?? 0}`)
  console.log('  logins:')
  console.log(
    `    manager  username=${managerUsername}  password=${managerPassword}  PIN=${managerPin}`,
  )
  console.log(
    `    cashier  username=${cashierUsername}  password=${cashierPassword}  PIN=${cashierPin}`,
  )
  console.log('  app: pnpm dev:testing → http://127.0.0.1:5174/login')
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
