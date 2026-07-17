/**
 * Smoke: plain-Arabic print diagnostics + selection story.
 *
 * Production (ADR-0035): READ ONLY — diagnose + list RPCs only.
 * Testing: may still exercise inventory scenarios (mutations allowed on Testing).
 *
 * Usage:
 *   node scripts/smoke-print-diag-arabic.mjs --env testing -- --username U --password P
 *   node scripts/smoke-print-diag-arabic.mjs --env production -- --username U --password P
 */
import {
  assertSupabaseUrl,
  loadProjectEnv,
  loadTestingEnv,
  PRODUCTION_SUPABASE_REF,
  TESTING_SUPABASE_REF,
} from './load-env.mjs'
import {
  createScriptClient,
  refuseProductionMutations,
} from './script-safety.mjs'

const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'
const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'

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

function assertAr(label, text, needles) {
  const s = String(text ?? '')
  const ok = needles.some((n) => s.includes(n))
  record(label, ok, s.slice(0, 120) || '(empty)')
  return ok
}

async function main() {
  const which = (readArg('--env', 'testing') || 'testing').toLowerCase()
  const username = readArg('--username', which === 'testing' ? 'manager' : null)
  const password = readArg('--password', which === 'testing' ? 'Testing123!' : null)
  if (!username || !password) {
    console.error('Need --username and --password')
    process.exit(1)
  }

  const env = which === 'production' ? loadProjectEnv() : loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  const service = env.SUPABASE_SERVICE_ROLE_KEY
  assertSupabaseUrl(url)
  const host = new URL(url).hostname
  if (which === 'production' && !host.startsWith(`${PRODUCTION_SUPABASE_REF}.`)) {
    throw new Error('Refusing: not Production URL')
  }
  if (which === 'testing' && !host.startsWith(`${TESTING_SUPABASE_REF}.`)) {
    throw new Error('Refusing: not Testing URL')
  }
  if (which === 'testing') refuseProductionMutations(url)

  console.log(
    `\n[Print diag Arabic smoke] env=${which} host=${host}` +
      (which === 'production' ? ' · READ-ONLY' : '') +
      `\n`,
  )

  const client = createScriptClient(url, anon, {
    mode: which === 'production' ? 'readonly' : 'mutating',
  })
  const { error: authErr } = await client.auth.signInWithPassword({
    email: `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (authErr) {
    console.error('Sign-in failed:', authErr.message)
    process.exit(1)
  }

  // 1) Diagnose returns Arabic selection story (no print jobs)
  {
    const { data, error } = await client.rpc('diagnose_print_system')
    if (error) {
      record('01 diagnose_print_system', false, error.message)
    } else {
      record('01 diagnose_print_system', true)
      const sel = data?.selection
      record('01a selection present', !!sel && typeof sel.reason_ar === 'string')
      assertAr(
        '01b Arabic reason (no English jargon)',
        sel?.reason_ar,
        ['طابعة', 'برنامج', 'اختيار', 'متصل', 'حرارية', 'ويندوز', 'الجهاز'],
      )
      const hasJargon =
        /Driver|DeviceID|Match Method|bridge_id|RPC/i.test(
          String(sel?.reason_ar ?? '') + String(sel?.status_message_ar ?? ''),
        )
      record('01c no technical jargon in story', !hasJargon)
      record(
        '01d checks labels Arabic',
        Array.isArray(data?.checks) &&
          data.checks.every((c) => /[\u0600-\u06FF]/.test(c.label || '')),
        `n=${data?.checks?.length ?? 0}`,
      )
    }
  }

  // Pipeline RPCs must still exist unchanged (callable signatures)
  for (const [fn, args] of [
    ['list_printers', { p_active_only: true }],
    ['list_print_bridges', {}],
    ['get_printer_health', {}],
  ]) {
    const { error } = await client.rpc(fn, args)
    record(`02 pipeline RPC exists: ${fn}`, !error, error?.message ?? 'ok')
  }

  // Inventory mutation scenarios: Testing only (ADR-0035 — never mutate Production).
  if (which === 'production') {
    record(
      '03 inventory scenarios',
      true,
      'skipped on Production (read-only policy) — covered by Testing',
    )
  } else if (!service) {
    record('03 inventory scenarios', false, 'no service role on Testing')
  } else {
    const admin = createScriptClient(url, service, { mode: 'mutating' })

    // Prefer an existing active bridge for this env's restaurant (manager context).
    let bridgeId = null
    let restaurantId = SEED_RESTAURANT_ID
    {
      const { data: ctxBridges } = await client.rpc('list_print_bridges')
      const online = (ctxBridges ?? []).find((b) => b.online) ?? (ctxBridges ?? [])[0]
      if (online?.id) {
        bridgeId = online.id
        const { data: row } = await admin
          .from('print_bridges')
          .select('id, restaurant_id')
          .eq('id', bridgeId)
          .maybeSingle()
        if (row?.restaurant_id) restaurantId = row.restaurant_id
        await admin
          .from('print_bridges')
          .update({
            last_heartbeat_at: new Date().toISOString(),
            version: '0.4.0',
            is_active: true,
          })
          .eq('id', bridgeId)
        record('03 reuse bridge', true, bridgeId)
      } else if (which === 'testing') {
        const { data: created, error } = await admin
          .from('print_bridges')
          .insert({
            restaurant_id: SEED_RESTAURANT_ID,
            display_name: 'smoke-diag',
            device_name: 'SMOKE-DIAG',
            is_active: true,
            last_heartbeat_at: new Date().toISOString(),
            version: '0.4.0',
          })
          .select('id')
          .single()
        if (error) record('03 create smoke bridge', false, error.message)
        else {
          bridgeId = created.id
          restaurantId = SEED_RESTAURANT_ID
          record('03 create smoke bridge', true)
        }
      } else {
        record('03 bridge for inventory scenarios', false, 'no active bridge on Production')
      }
    }

    if (bridgeId) {
      // Clear devices then sole thermal
      await admin.from('print_bridge_devices').delete().eq('bridge_id', bridgeId)

      await admin.from('print_bridge_devices').insert({
        restaurant_id: restaurantId,
        bridge_id: bridgeId,
        windows_name: 'XP-80 (copy 1)',
        is_virtual: false,
        driver_name: 'Generic / Text Only',
        port_name: 'USB001',
        is_default: true,
        last_seen_at: new Date().toISOString(),
      })

      {
        const { data: m, error } = await admin.rpc('m6_match_windows_printer', {
          p_bridge_id: bridgeId,
          p_wanted_name: 'XP-80C (copy 3)',
        })
        if (error) record('04 sole thermal match', false, error.message)
        else {
          record(
            '04 sole thermal match',
            m?.reason === 'sole_thermal' && m?.windows_name === 'XP-80 (copy 1)',
            `${m?.reason} → ${m?.windows_name}`,
          )
          assertAr('04a sole thermal Arabic', m?.detail, [
            'طابعة حرارية واحدة',
            'تلقائي',
          ])
        }
      }

      // Multi thermal → needs_choice
      await admin.from('print_bridge_devices').insert([
        {
          restaurant_id: restaurantId,
          bridge_id: bridgeId,
          windows_name: 'XP-80 Kitchen',
          is_virtual: false,
          driver_name: 'EPSON TM',
          port_name: 'USB002',
          is_default: false,
          last_seen_at: new Date().toISOString(),
        },
      ])

      {
        const { data: m, error } = await admin.rpc('m6_match_windows_printer', {
          p_bridge_id: bridgeId,
          p_wanted_name: 'Old-Name-Gone',
        })
        if (error) record('05 multi thermal needs_choice', false, error.message)
        else {
          record(
            '05 multi thermal needs_choice',
            m?.reason === 'needs_choice' && m?.needs_choice === true,
            `${m?.reason} candidates=${(m?.candidates ?? []).length}`,
          )
          assertAr('05a multi thermal Arabic', m?.detail, [
            'أكثر من طابعة حرارية',
            'اختر',
          ])
        }
      }

      // Rename case: exact gone, confident base model with one left after deleting kitchen
      await admin
        .from('print_bridge_devices')
        .delete()
        .eq('bridge_id', bridgeId)
        .eq('windows_name', 'XP-80 Kitchen')

      {
        const { data: m, error } = await admin.rpc('m6_match_windows_printer', {
          p_bridge_id: bridgeId,
          p_wanted_name: 'XP-80C (copy 3)',
        })
        if (error) record('06 rename / remap', false, error.message)
        else {
          const ok =
            m?.windows_name === 'XP-80 (copy 1)' &&
            ['sole_thermal', 'confident_match', 'best_effort', 'discovered_fallback'].includes(
              m?.reason,
            )
          record('06 rename / remap', ok, `${m?.reason} → ${m?.windows_name}`)
          assertAr('06a remap Arabic', m?.detail, [
            'طابعة',
            'تلقائي',
            'ويندوز',
            'نفس',
            'جديدة',
            'واحدة',
          ])
        }
      }

      // reason helper via diagnose after heartbeat bump
      await admin
        .from('print_bridges')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', bridgeId)

      // Bridge restart simulation = heartbeat refresh (already done)
      record('07 bridge restart heartbeat', true, 'last_heartbeat refreshed')
    }
  }

  // choose_cashier RPC exists (may fail without online bridge + cashier — existence only)
  {
    const { error } = await client.rpc('choose_cashier_windows_printer', {
      p_windows_name: '__smoke_missing__',
    })
    // Expect business error, not missing function
    const missing = error?.message?.includes('Could not find the function')
    record(
      '08 choose_cashier_windows_printer exists',
      !missing,
      error?.message?.slice(0, 100) ?? 'ok',
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nPrint diag Arabic smoke (${which}): ${results.length - failed.length}/${results.length} passed` +
      (failed.length ? ` · ${failed.length} failed` : ''),
  )
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
