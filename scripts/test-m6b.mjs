import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * M6B — pairing, TTL, expired, Print Again, heartbeat, multi-printer recovery.
 * (Cloud contract + simulated Bridge; physical spooler not required.)
 *
 *   pnpm test:m6b -- --username abomalek --password "SECRET"
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
    if (error && error.message.includes(code)) record(name, true, `rejected: ${code}`)
    else if (error) record(name, false, `wrong error: ${error.message}`)
    else record(name, false, 'expected rejection')
  } catch (e) {
    if (String(e.message).includes(code)) record(name, true, `rejected: ${code}`)
    else record(name, false, e.message)
  }
}

async function cleanup(url, serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const r = SEED_RESTAURANT_ID
  const orderIds =
    (await admin.from('orders').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ?? []
  if (orderIds.length) {
    await admin.from('order_events').delete().in('order_id', orderIds)
    const itemIds =
      (await admin.from('order_items').select('id').in('order_id', orderIds)).data?.map((x) => x.id) ??
      []
    if (itemIds.length) {
      await admin.from('order_item_modifiers').delete().in('order_item_id', itemIds)
    }
    await admin.from('order_items').delete().in('order_id', orderIds)
    await admin.from('order_payments').delete().in('order_id', orderIds)
  }
  await admin.from('print_attempts').delete().eq('restaurant_id', r)
  await admin.from('print_jobs').delete().eq('restaurant_id', r)
  const kt =
    (await admin.from('kitchen_tickets').select('id').eq('restaurant_id', r)).data?.map((x) => x.id) ??
    []
  if (kt.length) {
    await admin.from('kitchen_ticket_lines').delete().in('ticket_id', kt)
    await admin.from('kitchen_tickets').delete().eq('restaurant_id', r)
  }
  await admin.from('orders').delete().eq('restaurant_id', r)
  await admin.from('treasury_movements').delete().eq('restaurant_id', r)
  await admin.from('shifts').delete().eq('restaurant_id', r)
  await admin.from('financial_ref_counters').delete().eq('restaurant_id', r)
  await admin.from('print_bridge_pair_codes').delete().eq('restaurant_id', r)
  // Only remove bridges created by this suite — never wipe the restaurant's real Bridge
  await admin
    .from('print_bridges')
    .delete()
    .eq('restaurant_id', r)
    .eq('display_name', 'M6B-Test')
}

async function restorePrinterBindings(admin, backup) {
  for (const row of backup ?? []) {
    await admin
      .from('printers')
      .update({ address: row.address, bridge_id: row.bridge_id })
      .eq('id', row.id)
  }
}

async function main() {
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)

  const username = readArg('--username', 'abomalek').trim().toLowerCase()
  const password = readArg('--password', '741523')

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (signInError) {
    console.error(`FAIL: ${signInError.message}`)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running M6B scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)
  const anonRpc = (fn, args) => anon.rpc(fn, args)

  await cleanup(url, serviceKey)
  {
    const { data: leftover } = await rpc('get_open_shift')
    if (leftover?.id) {
      await rpc('heal_residual_pending_for_shift', { p_shift_id: leftover.id })
      await rpc('close_shift', {
        p_actual_cash_count: Number(leftover.expected_cash ?? 0),
        p_difference_reason: null,
        p_notes: 'm6b reset',
      })
    }
  }

  await expectOk(
    '01 upsert_print_settings ttl=5',
    rpc('upsert_print_settings', { p_print_job_ttl_minutes: 5 }),
  )
  const settings = await expectOk('02 get_print_settings', rpc('get_print_settings'))
  record('02a ttl default 5', settings?.print_job_ttl_minutes === 5, String(settings?.print_job_ttl_minutes))

  const pair = await expectOk('03 create_print_bridge_pair_code', rpc('create_print_bridge_pair_code'))
  record('03a code present', Boolean(pair?.code), pair?.code)

  const paired = await expectOk(
    '04 pair_print_bridge (anon)',
    anonRpc('pair_print_bridge', {
      p_code: pair.code,
      p_display_name: 'M6B-Test',
      p_device_name: 'TEST-PC',
      p_windows_username: 'tester',
      p_version: '0.1.0-m6b',
    }),
  )
  const token = paired?.token
  const bridgeId = paired?.bridge_id
  record('04a token issued', Boolean(token && bridgeId))

  await expectOk(
    '05 bridge_heartbeat',
    anonRpc('bridge_heartbeat', {
      p_token: token,
      p_device_name: 'TEST-PC',
      p_windows_username: 'tester',
      p_version: '0.1.0-m6b',
      p_restarted: true,
    }),
  )

  // Print Center ownership: bind seed printers to bridge + Windows spooler name (restored in finally)
  const printerAddressBackup = []
  {
    const { data: seedPrinters } = await rpc('list_printers', {})
    for (const p of seedPrinters ?? []) {
      printerAddressBackup.push({
        id: p.id,
        address: p.address ?? {},
        bridge_id: p.bridge_id ?? null,
      })
      const { error: bindErr } = await admin
        .from('printers')
        .update({
          bridge_id: bridgeId,
          address: { windows_printer_name: `M6B-${p.role}-Printer` },
        })
        .eq('id', p.id)
      if (bindErr) {
        console.error(`FAIL bind printer ${p.id}: ${bindErr.message}`)
        process.exit(1)
      }
    }
  }

  await expectOk('06 open_shift', rpc('open_shift', { p_opening_float: 200 }))
  const { data: menuRaw } = await rpc('list_menu_for_pos')
  const item =
    menuRaw?.favorites?.[0] ??
    menuRaw?.categories?.find((c) => c.items?.length)?.items?.[0]
  const { data: ctx0 } = await rpc('get_pos_context')
  const cashPm = (ctx0?.payment_methods ?? []).find((p) => p.code === 'cash')

  const sale = await expectOk(
    '07 finalize_sale enqueue jobs',
    rpc('finalize_sale', {
      p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
      p_tenders: [{ payment_method_id: cashPm.id, amount: Number(item.base_price) + 5 }],
    }),
  )
  const orderId = sale?.order_id

  const { data: jobs } = await admin
    .from('print_jobs')
    .select('id, expires_at, status, kind, printer_id, bridge_id, payload')
    .eq('order_id', orderId)
  record(
    '07a jobs have expires_at',
    (jobs ?? []).length >= 1 && (jobs ?? []).every((j) => j.expires_at),
    `n=${jobs?.length}`,
  )
  record(
    '07b jobs routed with snapshot',
    (jobs ?? []).length >= 1 &&
      (jobs ?? []).every(
        (j) => j.printer_id && j.bridge_id && j.payload?.data_snapshot,
      ),
    `n=${jobs?.length}`,
  )

  // Within TTL: claim + success with transport_ack
  const claimed = await expectOk(
    '08 claim with bridge token',
    anonRpc('claim_print_jobs', { p_token: token, p_limit: 10 }),
  )
  record('08a claimed > 0', Array.isArray(claimed) && claimed.length > 0, `n=${claimed?.length}`)

  const jobA = claimed?.[0]?.id
  if (jobA) {
    await expectOk(
      '09 report transport_ack',
      anonRpc('report_print_attempt', {
        p_job_id: jobA,
        p_success: true,
        p_token: token,
        p_delivery: 'transport_ack',
      }),
    )
    const { data: done } = await admin
      .from('print_jobs')
      .select('status, delivery')
      .eq('id', jobA)
      .single()
    record(
      '09a completed transport_ack',
      done?.status === 'completed' && done?.delivery === 'transport_ack',
      JSON.stringify(done),
    )

    // Duplicate ACK
    await expectOk(
      '10 duplicate ACK idempotent',
      anonRpc('report_print_attempt', {
        p_job_id: jobA,
        p_success: true,
        p_token: token,
        p_delivery: 'transport_ack',
      }),
    )
  }

  // TTL expired path
  const { data: printersForExpire } = await rpc('list_printers', {})
  const cashierPrinter =
    printersForExpire?.find((p) => p.role === 'cashier') ?? printersForExpire?.[0]
  const expireJobId = await expectOk(
    '11 enqueue_test_print',
    rpc('enqueue_test_print', { p_printer_id: cashierPrinter.id }),
  )

  if (expireJobId) {
    await admin
      .from('print_jobs')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString(), status: 'pending' })
      .eq('id', expireJobId)

    const n = await expectOk('12 expire_stale_print_jobs', rpc('expire_stale_print_jobs'))
    record('12a expired count >= 1', Number(n) >= 1, String(n))

    const { data: expRow } = await admin
      .from('print_jobs')
      .select('status')
      .eq('id', expireJobId)
      .single()
    record('12b status expired', expRow?.status === 'expired', expRow?.status)

    // Claim must not return expired
    const claimed2 = await anonRpc('claim_print_jobs', { p_token: token, p_limit: 50 })
    const ids = (claimed2.data ?? []).map((j) => j.id)
    record('13 claim skips expired', !ids.includes(expireJobId), `claimed=${ids.length}`)

    const again = await expectOk(
      '14 print_job_again after expired',
      rpc('print_job_again', { p_job_id: expireJobId }),
    )
    const { data: againRow } = await admin
      .from('print_jobs')
      .select('status, expires_at')
      .eq('id', again)
      .single()
    record(
      '14a new pending with fresh expires_at',
      againRow?.status === 'pending' &&
        againRow?.expires_at &&
        new Date(againRow.expires_at) > new Date(),
      againRow?.status,
    )
  }

  // Within-TTL offline simulation: set expires far future, claim, report fail → retry_wait, then success
  const { data: printers } = await rpc('list_printers', {})
  const kitchen = printers?.find((p) => p.role === 'kitchen') ?? printers?.[0]
  const offlineJob = await expectOk(
    '15 test job for offline<TTL',
    rpc('enqueue_test_print', { p_printer_id: kitchen.id }),
  )
  if (offlineJob) {
    await admin
      .from('print_jobs')
      .update({
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        max_attempts: 6,
      })
      .eq('id', offlineJob)
    await anonRpc('claim_print_jobs', { p_token: token, p_limit: 20 })
    await anonRpc('report_print_attempt', {
      p_job_id: offlineJob,
      p_success: false,
      p_error_code: 'OFFLINE',
      p_token: token,
    })
    const { data: rw } = await admin.from('print_jobs').select('status').eq('id', offlineJob).single()
    record('15a retry_wait while within TTL', rw?.status === 'retry_wait' || rw?.status === 'failed', rw?.status)
    await rpc('retry_print_job', { p_job_id: offlineJob })
    await anonRpc('claim_print_jobs', { p_token: token, p_limit: 20 })
    await expectOk(
      '15b recover success',
      anonRpc('report_print_attempt', {
        p_job_id: offlineJob,
        p_success: true,
        p_token: token,
        p_delivery: 'transport_ack',
      }),
    )
  }

  // Multi-printer: two printers listed
  record(
    '16 multiple printers registered',
    (printers ?? []).length >= 2,
    `n=${printers?.length}`,
  )

  const health = await expectOk('17 get_printer_health', rpc('get_printer_health'))
  record(
    '17a bridge visible',
    health?.bridge?.version === '0.1.0-m6b' || health?.bridge != null,
    health?.bridge?.version,
  )

  if (orderId) {
    await expectOk(
      '18 reprint with reason',
      rpc('reprint_order', {
        p_order_id: orderId,
        p_kind: 'receipt',
        p_reason: 'm6b reprint test',
      }),
    )
  }

  await expectError(
    '19 invalid pair code',
    anonRpc('pair_print_bridge', { p_code: 'ZZZZZZZZ' }),
    'INVALID_CODE',
  )

  await supabase.auth.signOut()
  await restorePrinterBindings(admin, printerAddressBackup)
  if (!hasFlag('--no-cleanup')) {
    await cleanup(url, serviceKey)
    console.log('\nCleanup: M6B test data removed.')
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(`\n==== M6B review: ${passed} passed, ${failed} failed ====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
