import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'

/**
 * Portable printer ownership — Pair on device B takes all printers/jobs from device A.
 *
 *   pnpm test:portable-printer
 *   pnpm test:portable-printer -- --username manager --password "Testing123!"
 */

const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'
const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'
const BRIDGE_A = 'Portable-Test-A'
const BRIDGE_B = 'Portable-Test-B'

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

async function cleanup(admin) {
  const r = SEED_RESTAURANT_ID
  await admin
    .from('print_jobs')
    .delete()
    .eq('restaurant_id', r)
    .in('status', ['pending', 'retry_wait', 'claimed', 'cancelled'])
  await admin.from('print_bridge_pair_codes').delete().eq('restaurant_id', r)
  await admin
    .from('print_bridges')
    .delete()
    .eq('restaurant_id', r)
    .in('display_name', [BRIDGE_A, BRIDGE_B])
}

async function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)
  refuseProductionMutations(env.VITE_SUPABASE_URL)

  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY missing in .env.testing')
    process.exit(1)
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(url, serviceKey, {
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

  console.log(`\n[Testing] Portable printer ownership — signed in as ${username}\n`)
  const rpc = (fn, args) => supabase.rpc(fn, args)
  const anonRpc = (fn, args) => anon.rpc(fn, args)

  await cleanup(admin)

  const printerBackup = []
  const { data: printers } = await rpc('list_printers', { p_active_only: true })
  const list = printers ?? []
  record('01 list printers', list.length > 0, `count=${list.length}`)
  if (!list.length) {
    console.error('No printers — seed Testing first')
    process.exit(1)
  }
  for (const p of list) {
    printerBackup.push({
      id: p.id,
      bridge_id: p.bridge_id ?? null,
      address: p.address ?? {},
    })
  }

  try {
    await expectOk(
      '02 enable testing print',
      rpc('set_testing_print_enabled', { p_enabled: true }),
    )

    const pairA = await expectOk(
      '03 create pair code A',
      rpc('create_print_bridge_pair_code'),
    )
    const bridgedA = await expectOk(
      '04 pair device A',
      anonRpc('pair_print_bridge', {
        p_code: pairA.code,
        p_display_name: BRIDGE_A,
        p_device_name: 'PORTABLE-PC-A',
        p_windows_username: 'tester',
        p_version: '0.5.8-test',
      }),
    )
    const bridgeA = bridgedA?.bridge_id
    const tokenA = bridgedA?.token
    record('04a bridge A id', Boolean(bridgeA))

    for (const p of list) {
      const { error } = await admin
        .from('printers')
        .update({
          bridge_id: bridgeA,
          address: {
            ...(p.address ?? {}),
            windows_printer_name: 'XP-80-Portable-A',
          },
        })
        .eq('id', p.id)
      if (error) {
        record('05 bind printers to A', false, error.message)
        process.exit(1)
      }
    }
    record('05 bind printers to A', true, `n=${list.length}`)

    await expectOk(
      '06 heartbeat A online',
      anonRpc('bridge_heartbeat', {
        p_token: tokenA,
        p_device_name: 'PORTABLE-PC-A',
        p_windows_username: 'tester',
        p_version: '0.5.8-test',
        p_restarted: false,
      }),
    )

    const cashier =
      list.find((p) => p.role === 'cashier' && p.is_active) ?? list.find((p) => p.is_active)
    const { data: jobId, error: enqErr } = await rpc('enqueue_test_print', {
      p_printer_id: cashier.id,
    })
    if (enqErr) {
      record('07 enqueue job on A', false, enqErr.message)
    } else {
      record('07 enqueue job on A', Boolean(jobId), `job=${jobId}`)
      await admin
        .from('print_jobs')
        .update({ bridge_id: bridgeA, status: 'pending' })
        .eq('id', jobId)
    }

    // Keep A "online" while B pairs on a different device_name — ownership must move.
    const pairB = await expectOk(
      '08 create pair code B',
      rpc('create_print_bridge_pair_code'),
    )
    const bridgedB = await expectOk(
      '09 pair device B (different PC)',
      anonRpc('pair_print_bridge', {
        p_code: pairB.code,
        p_display_name: BRIDGE_B,
        p_device_name: 'PORTABLE-PC-B',
        p_windows_username: 'tester',
        p_version: '0.5.8-test',
      }),
    )
    const bridgeB = bridgedB?.bridge_id
    const tokenB = bridgedB?.token
    record('09a bridge B id', Boolean(bridgeB && bridgeB !== bridgeA))
    record(
      '09b ownership payload',
      bridgedB?.ownership?.ok === true,
      `peers=${bridgedB?.ownership?.peers_deactivated}`,
    )

    const { data: aRow } = await admin
      .from('print_bridges')
      .select('id, is_active')
      .eq('id', bridgeA)
      .maybeSingle()
    record('10 bridge A deactivated', aRow?.is_active === false, `active=${aRow?.is_active}`)

    const { data: printersAfter } = await admin
      .from('printers')
      .select('id, bridge_id')
      .eq('restaurant_id', SEED_RESTAURANT_ID)
      .eq('is_active', true)
    const allOnB = (printersAfter ?? []).every((p) => p.bridge_id === bridgeB)
    record(
      '11 all printers on B',
      allOnB,
      `sample=${printersAfter?.[0]?.bridge_id}`,
    )

    if (jobId) {
      const { data: job } = await admin
        .from('print_jobs')
        .select('id, bridge_id, status')
        .eq('id', jobId)
        .maybeSingle()
      record(
        '12 pending job rerouted to B',
        job?.bridge_id === bridgeB && job?.status === 'pending',
        `bridge=${job?.bridge_id} status=${job?.status}`,
      )
    }

    await expectOk(
      '13 heartbeat B',
      anonRpc('bridge_heartbeat', {
        p_token: tokenB,
        p_device_name: 'PORTABLE-PC-B',
        p_windows_username: 'tester',
        p_version: '0.5.8-test',
        p_restarted: true,
      }),
    )

    const claimed = await expectOk(
      '14 claim from B',
      anonRpc('claim_print_jobs', {
        p_bridge_id: null,
        p_limit: 10,
        p_token: tokenB,
      }),
    )
    const claimedList = Array.isArray(claimed) ? claimed : []
    record(
      '14a B got jobs or empty ok',
      Array.isArray(claimed),
      `len=${claimedList.length}`,
    )
    if (jobId && claimedList.length) {
      record(
        '14b claimed includes rerouted job',
        claimedList.some((j) => j.id === jobId || j.job_id === jobId),
      )
    }

    // A token must no longer claim (inactive).
    const { data: claimA, error: claimAErr } = await anon.rpc('claim_print_jobs', {
      p_bridge_id: null,
      p_limit: 5,
      p_token: tokenA,
    })
    record(
      '15 A token rejected or empty',
      Boolean(claimAErr) || (Array.isArray(claimA) && claimA.length === 0),
      claimAErr?.message ?? `len=${Array.isArray(claimA) ? claimA.length : '?'}`,
    )
  } finally {
    for (const row of printerBackup) {
      await admin
        .from('printers')
        .update({ bridge_id: row.bridge_id, address: row.address })
        .eq('id', row.id)
    }
    await cleanup(admin)
    await rpc('set_testing_print_enabled', { p_enabled: false })
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nDone: ${results.length - failed.length}/${results.length} passed.` +
      (failed.length ? ` Failed: ${failed.map((f) => f.name).join(', ')}` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
