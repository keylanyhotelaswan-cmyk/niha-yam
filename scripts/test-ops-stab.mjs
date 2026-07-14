import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * Operational Stabilization regression suite.
 *
 * Usage:
 *   pnpm test:ops-stab -- --username abomalek --password "SECRET"
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

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  assertSupabaseUrl(url)
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')

  const username = (readArg('--username', 'abomalek')).trim().toLowerCase()
  const password = readArg('--password', '741523')

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
    password,
  })
  if (signInError) {
    console.error(`FAIL: sign-in ${signInError.message}`)
    process.exit(1)
  }
  console.log(`\nSigned in as ${username}. Running ops-stab scenarios…\n`)

  const rpc = (fn, args) => supabase.rpc(fn, args)

  // ---------------------------------------------------------------------------
  // A) Ops Feedback refs
  // ---------------------------------------------------------------------------
  const note1 = await rpc('submit_ops_feedback', {
    p_title: 'stab-note-1',
    p_body: 'regression body one for ops feedback ref',
    p_kind: 'note',
    p_priority: 'normal',
  })
  const note2 = await rpc('submit_ops_feedback', {
    p_title: 'stab-note-2',
    p_body: 'regression body two for ops feedback ref',
    p_kind: 'problem',
    p_priority: 'important',
  })
  record('Ops feedback submit #1', !note1.error && !!note1.data?.reference, note1.error?.message ?? note1.data?.reference)
  record('Ops feedback submit #2', !note2.error && !!note2.data?.reference, note2.error?.message ?? note2.data?.reference)
  record(
    'Ops feedback NT refs unique',
    !note1.error &&
      !note2.error &&
      note1.data?.reference !== note2.data?.reference &&
      String(note1.data?.reference || '').startsWith('NT-'),
    `${note1.data?.reference} vs ${note2.data?.reference}`,
  )

  const list = await rpc('list_ops_feedback_admin', {
    p_status: null,
    p_search: 'stab-note',
    p_limit: 20,
    p_offset: 0,
  })
  record(
    'Ops feedback admin list succeeds',
    !list.error && Array.isArray(list.data),
    list.error?.message ?? `rows=${list.data?.length ?? 0}`,
  )

  // ---------------------------------------------------------------------------
  // B) Transfer race + post-execute reject
  // ---------------------------------------------------------------------------
  const open = await rpc('get_open_shift')
  if (!open.data?.id) {
    await rpc('open_shift', { p_opening_float: 500 })
  }

  const { data: balRows } = await rpc('get_treasury_balances')
  const drawer = (balRows ?? []).find((t) => t.is_shift_drawer)
  const safe = (balRows ?? []).find((t) => t.type === 'cash' && !t.is_shift_drawer)
  const digital = (balRows ?? []).find((t) => !t.is_shift_drawer && t.id !== safe?.id)

  if (!drawer || !safe || !digital) {
    record('Treasury fixtures', false, 'need drawer + cash safe + digital')
  } else {
    if (Number(safe.balance ?? 0) < 20) {
      await rpc('cash_drop', { p_amount: 50, p_reason: 'ops-stab seed' })
    }

    const created = await rpc('create_transfer', {
      p_source_treasury_id: safe.id,
      p_dest_treasury_id: digital.id,
      p_amount: 5,
      p_reason: 'ops-stab race',
    })
    record('create_transfer → pending', !created.error && !!created.data, created.error?.message ?? String(created.data))

    const tid = created.data
    if (tid) {
      const [a, r] = await Promise.all([
        rpc('approve_transfer', { p_id: tid }),
        rpc('reject_transfer', { p_id: tid, p_reason: 'ops-stab race reject' }),
      ])
      const aOk = !a.error
      const rOk = !r.error
      record(
        'Concurrent approve∥reject: exactly one success',
        (aOk ? 1 : 0) + (rOk ? 1 : 0) === 1,
        `approve=${aOk} (${a.error?.message ?? 'ok'}) reject=${rOk} (${r.error?.message ?? 'ok'})`,
      )

      const { data: row } = await supabase
        .from('treasury_transfers')
        .select('id,status')
        .eq('id', tid)
        .maybeSingle()
      const status = row?.status
      record(
        'Transfer final status executed|rejected',
        status === 'executed' || status === 'rejected',
        `status=${status}`,
      )

      if (status === 'executed') {
        const again = await rpc('reject_transfer', {
          p_id: tid,
          p_reason: 'should fail after execute',
        })
        record(
          'reject_transfer after executed → INVALID_STATE',
          !!again.error && String(again.error.message).includes('INVALID_STATE'),
          again.error?.message ?? 'unexpected ok',
        )
        const { count } = await supabase
          .from('treasury_movements')
          .select('id', { count: 'exact', head: true })
          .eq('transfer_id', tid)
        record('Executed transfer has 2 movements', count === 2, `movements=${count}`)
      }

      if (status === 'rejected') {
        const { count } = await supabase
          .from('treasury_movements')
          .select('id', { count: 'exact', head: true })
          .eq('transfer_id', tid)
        record('Rejected transfer has 0 movements', count === 0, `movements=${count}`)
      }
    }

    // POS operational transfer path (drawer → digital) if funds allow
    const { data: bal2 } = await rpc('get_treasury_balances')
    const drawer2 = (bal2 ?? []).find((t) => t.is_shift_drawer)
    const dig2 = (bal2 ?? []).find((t) => !t.is_shift_drawer && t.id !== safe.id)
    if (drawer2 && dig2 && Number(drawer2.balance ?? 0) >= 3) {
      const posTr = await rpc('pos_operational_transfer', {
        p_source_treasury_id: drawer2.id,
        p_dest_treasury_id: dig2.id,
        p_amount: 3,
        p_reason: 'ops-stab pos',
      })
      // May fail TRANSFER_NOT_ALLOWED if dig2 not linked to instapay/ewallet — soft check
      if (posTr.error && String(posTr.error.message).includes('TRANSFER_NOT_ALLOWED')) {
        record('pos_operational_transfer constraints enforced', true, 'TRANSFER_NOT_ALLOWED as expected for non-digital dest')
      } else {
        record(
          'pos_operational_transfer executes or funds fail cleanly',
          !posTr.error ||
            String(posTr.error.message).includes('INSUFFICIENT_FUNDS') ||
            String(posTr.error.message).includes('TRANSFER_NOT_ALLOWED'),
          posTr.error?.message ?? String(posTr.data),
        )
      }
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nOps-stab summary: ${results.length - failed.length}/${results.length} passed.`)
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
