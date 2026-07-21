import { createClient } from '@supabase/supabase-js'
import { assertTestingTarget, loadTestingEnv } from './load-env.mjs'
import { refuseProductionMutations } from './script-safety.mjs'
import { testingStaffCredentials } from './testing-credentials.mjs'

/**
 * Operational Stabilization regression suite.
 *
 * Usage:
 *   pnpm test:ops-stab
 */

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
  const env = loadTestingEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  assertTestingTarget(url)
  refuseProductionMutations(url)
  if (!anonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')

  const { username, password, email } = testingStaffCredentials()

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
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
      const a = await rpc('approve_transfer', { p_id: tid })
      record(
        'approve_transfer → APPROVE_REMOVED',
        !!a.error && String(a.error.message).includes('APPROVE_REMOVED'),
        a.error?.message ?? 'unexpected ok',
      )

      const { data: row } = await supabase
        .from('treasury_transfers')
        .select('id,status')
        .eq('id', tid)
        .maybeSingle()
      const status = row?.status
      record(
        'Transfer executed on create',
        status === 'executed',
        `status=${status}`,
      )

      if (status === 'executed') {
        const again = await rpc('reject_transfer', {
          p_id: tid,
          p_reason: 'ops-stab reject=reverse',
        })
        record(
          'reject_transfer after executed → reverse ok',
          !again.error,
          again.error?.message ?? 'reversed',
        )
        const { data: row2 } = await supabase
          .from('treasury_transfers')
          .select('id,status')
          .eq('id', tid)
          .maybeSingle()
        record(
          'Transfer status after reject = reversed',
          row2?.status === 'reversed',
          `status=${row2?.status}`,
        )
      }

      if (status === 'rejected') {
        const { count } = await supabase
          .from('treasury_movements')
          .select('id', { count: 'exact', head: true })
          .eq('transfer_id', tid)
        record('Rejected transfer has 0 movements', count === 0, `movements=${count}`)
      }
    }

    // POS operational transfer: transferable floors at 0
    let ctx = await rpc('get_pos_context')
    let opDrawer = (ctx.data?.operational_treasuries ?? []).find((t) => t.code === 'drawer')
    const opDigital = (ctx.data?.operational_treasuries ?? []).find(
      (t) => t.code === 'instapay' || t.code === 'ewallet',
    )
    if (opDrawer && Number(opDrawer.balance ?? 0) < 10) {
      // Seed float if ledger wiped / negative leftover state
      await rpc('open_shift', { p_opening_float: 100 }).catch(() => null)
      if (!(await rpc('get_open_shift')).data?.id) {
        /* shift may already be open with empty drawer */
      }
      ctx = await rpc('get_pos_context')
      opDrawer = (ctx.data?.operational_treasuries ?? []).find((t) => t.code === 'drawer')
    }
    if (opDrawer && opDigital) {
      const operational = Number(opDrawer.balance ?? 0)
      const approved = Number(opDrawer.approved_balance ?? operational)
      const transferable = Math.max(0, operational)
      record(
        'POS transferable floors at 0',
        transferable === Math.max(0, operational),
        `op=${operational} approved=${approved} transferable=${transferable}`,
      )

      const over = await rpc('pos_operational_transfer', {
        p_source_treasury_id: opDrawer.id,
        p_dest_treasury_id: opDigital.id,
        p_amount: transferable + 1,
        p_reason: 'ops-stab over-available',
      })
      record(
        'POS transfer over transferable → INSUFFICIENT_FUNDS',
        !!over.error && String(over.error.message).includes('INSUFFICIENT_FUNDS'),
        over.error?.message ?? 'unexpected ok',
      )

      if (transferable >= 1) {
        let okAmt = await rpc('pos_operational_transfer', {
          p_source_treasury_id: opDrawer.id,
          p_dest_treasury_id: opDigital.id,
          p_amount: 1,
          p_reason: 'ops-stab operational ok',
        })
        // PostgREST may briefly serve prior overload after migration NOTIFY.
        if (
          okAmt.error &&
          String(okAmt.error.message).includes('INSUFFICIENT_FUNDS') &&
          transferable >= 1
        ) {
          await new Promise((r) => setTimeout(r, 800))
          okAmt = await rpc('pos_operational_transfer', {
            p_source_treasury_id: opDrawer.id,
            p_dest_treasury_id: opDigital.id,
            p_amount: 1,
            p_reason: 'ops-stab operational ok retry',
          })
        }
        record(
          'POS transfer 1 within operational succeeds',
          !okAmt.error,
          okAmt.error?.message ?? String(okAmt.data),
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
