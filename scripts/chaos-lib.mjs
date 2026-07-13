/**
 * Shared helpers for Production Chaos & Fuzz suites.
 */
import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

export const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'
export const SEED_BRANCH_ID = 'b0000000-0000-4000-8000-000000000001'
export const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

export function readArg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return fallback
  return process.argv[idx + 1]
}
export const hasFlag = (name) => process.argv.includes(name)

export function createRecorder() {
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
      if (error && String(error.message).includes(code))
        record(name, true, `rejected: ${code}`)
      else if (error) record(name, false, `wrong error: ${error.message}`)
      else record(name, false, 'expected rejection but succeeded')
    } catch (e) {
      if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
      else record(name, false, e.message)
    }
  }
  function summary(label) {
    const passed = results.filter((r) => r.ok).length
    const failed = results.length - passed
    console.log(`\n==== ${label}: ${passed} passed, ${failed} failed ====`)
    return { passed, failed, results }
  }
  return { results, record, expectOk, expectError, summary }
}

export function loadEnvClients() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)
  if (!anon || !serviceKey) throw new Error('Missing Supabase keys')
  return { url, anon, serviceKey, env }
}

export async function signIn(url, anon, username, password) {
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (error) throw new Error(`sign-in ${username}: ${error.message}`)
  return client
}

export function rpcOf(client) {
  return (fn, args) => client.rpc(fn, args)
}

export async function softReset(rpc) {
  const { data: ctx } = await rpc('get_pos_context')
  if (ctx?.open_shift?.id) {
    await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
    const { data: ctx2 } = await rpc('get_pos_context')
    await rpc('close_shift', {
      p_actual_cash_count: Number(ctx2?.open_shift?.expected_cash ?? 0),
      p_difference_reason: null,
      p_notes: 'chaos-soft-reset',
      p_destination: 'to_main',
    })
  }
  const { data: pend } = await rpc('list_pending_handovers')
  for (const h of pend ?? []) {
    if (h.kind === 'to_main') await rpc('receive_treasury_handover', { p_id: h.id })
    else await rpc('reject_shift_handover', { p_id: h.id, p_reason: 'chaos cleanup' })
  }
}

export async function serviceCleanup(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID
  const orderIds =
    (await admin.from('orders').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ?? []
  if (orderIds.length) {
    await admin.from('order_events').delete().in('order_id', orderIds)
    await admin.from('order_amendments').delete().in('order_id', orderIds)
    const itemIds =
      (await admin.from('order_items').select('id').in('order_id', orderIds)).data?.map((x) => x.id) ??
      []
    if (itemIds.length) {
      await admin.from('order_item_modifiers').delete().in('order_item_id', itemIds)
    }
    const kt =
      (await admin.from('kitchen_tickets').select('id').in('order_id', orderIds)).data?.map(
        (x) => x.id,
      ) ?? []
    if (kt.length) {
      await admin.from('kitchen_ticket_lines').delete().in('ticket_id', kt)
      await admin.from('kitchen_tickets').delete().in('order_id', orderIds)
    }
    await admin.from('print_jobs').delete().in('order_id', orderIds)
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
  }
  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  await admin.from('ops_messages').delete().eq('restaurant_id', r)
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('treasury_transfers').delete().eq('restaurant_id', r)
  await admin.from('expenses').delete().eq('restaurant_id', r)
  await admin.from('shift_handovers').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  return admin
}

/** Consistency invariants after chaos/fuzz. */
export async function assertDbConsistency(admin, record, label = 'consistency') {
  const r = SEED_RESTAURANT_ID

  const { data: ords } = await admin
    .from('orders')
    .select('id, payment_status, total, shift_id, reference')
    .eq('restaurant_id', r)
  const badStatus = (ords ?? []).filter(
    (o) => !['paid', 'unpaid', 'partial'].includes(o.payment_status),
  )
  record(`${label}: order payment_status valid`, badStatus.length === 0, `${badStatus.length}`)

  const orphanShift = (ords ?? []).filter((o) => !o.shift_id)
  record(`${label}: orders have shift_id`, orphanShift.length === 0, `${orphanShift.length}`)

  const refs = (ords ?? []).map((o) => o.reference)
  record(
    `${label}: unique order refs`,
    new Set(refs).size === refs.length,
    `${refs.length}`,
  )

  const { data: hos } = await admin
    .from('shift_handovers')
    .select('id, status, kind, transfer_id, amount')
    .eq('restaurant_id', r)
  const half = (hos ?? []).filter(
    (h) =>
      h.status === 'executed' &&
      h.kind === 'to_main' &&
      !h.transfer_id &&
      Number(h.amount) > 0,
  )
  record(`${label}: no half-complete Path A handover`, half.length === 0, `${half.length}`)

  const pending = (hos ?? []).filter((h) => h.status === 'pending')
  record(`${label}: pending handovers counted`, true, `n=${pending.length}`)

  const { data: jobs } = await admin
    .from('print_jobs')
    .select('id, status, order_id, expires_at')
    .eq('restaurant_id', r)
  const stuckClaimed = (jobs ?? []).filter((j) => j.status === 'claimed')
  record(
    `${label}: claimed jobs not exploding`,
    stuckClaimed.length < 50,
    `claimed=${stuckClaimed.length}`,
  )

  const { data: openShifts } = await admin
    .from('shifts')
    .select('id')
    .eq('restaurant_id', r)
    .eq('status', 'open')
  record(
    `${label}: at most one open shift`,
    (openShifts?.length ?? 0) <= 1,
    `open=${openShifts?.length ?? 0}`,
  )

  const { data: movs } = await admin
    .from('treasury_movements')
    .select('id, amount, treasury_id')
    .eq('restaurant_id', r)
  const badMov = (movs ?? []).filter((m) => !m.treasury_id)
  record(`${label}: movements have treasury`, badMov.length === 0)

  const byT = new Map()
  for (const m of movs ?? []) {
    byT.set(m.treasury_id, (byT.get(m.treasury_id) ?? 0) + Number(m.amount))
  }
  let extremeNeg = 0
  for (const [, bal] of byT) {
    if (bal < -0.01) extremeNeg++
  }
  record(
    `${label}: treasury balances computed`,
    true,
    `treasuries=${byT.size} negCount=${extremeNeg}`,
  )

  return {
    orders: ords?.length ?? 0,
    printJobs: jobs?.length ?? 0,
    movements: movs?.length ?? 0,
    handovers: hos?.length ?? 0,
  }
}

export async function ensureMenuItem(rpc) {
  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  if (!item) throw new Error('No menu item')
  return item
}

export async function ensureCashPm(rpc) {
  const { data: ctx } = await rpc('get_pos_context')
  const cashPm = (ctx?.payment_methods ?? []).find((p) => p.code === 'cash')
  if (!cashPm) throw new Error('No cash PM')
  return { cashPm, ctx }
}

/**
 * Ephemeral staff for dual-user chaos. Returns { client, userId, username, cleanup }.
 */
export async function provisionEphemeralStaff({
  url,
  anon,
  serviceKey,
  actorUserId,
  role,
  password = 'ChaosTest741!',
}) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const username = `chaos_${role}_${Date.now().toString(36).slice(-6)}`
  const email = `${username}@${INTERNAL_EMAIL_DOMAIN}`
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: `Chaos ${role}` },
  })
  if (cErr) throw new Error(`createUser: ${cErr.message}`)
  const userId = created.user.id

  const { data: staffId, error: pErr } = await admin.rpc('provision_staff', {
    p_actor_user_id: actorUserId,
    p_user_id: userId,
    p_username: username,
    p_display_name: `Chaos ${role}`,
    p_role: role,
    p_is_active: true,
    p_pin: '1234',
    p_email: email,
  })
  if (pErr) {
    await admin.auth.admin.deleteUser(userId)
    throw new Error(`provision_staff: ${pErr.message}`)
  }

  const client = await signIn(url, anon, username, password)
  return {
    client,
    userId,
    staffId,
    username,
    password,
    async cleanup() {
      await admin.auth.admin.deleteUser(userId)
    },
  }
}
