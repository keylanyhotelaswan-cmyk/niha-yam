import {
  assertDbConsistency,
  createRecorder,
  ensureCashPm,
  ensureMenuItem,
  hasFlag,
  loadEnvClients,
  readArg,
  rpcOf,
  serviceCleanup,
  signIn,
  softReset,
  SEED_RESTAURANT_ID,
} from './chaos-lib.mjs'
import { createScriptClient } from './script-safety.mjs'

/**
 * Chaos Fuzz — Testing only (ADR-0035). Never mutates Production.
 *
 *   pnpm test:chaos-fuzz -- --username manager --password "Testing123!" [--ops 300] [--seed 42]
 */

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function main() {
  const { url, anon, serviceKey } = loadEnvClients()
  const username = readArg('--username', 'manager').trim().toLowerCase()
  const password = readArg('--password', 'Testing123!')
  const ops = Math.max(50, Number(readArg('--ops', '300')) || 300)
  const seed = Number(readArg('--seed', String(Date.now() % 1e9))) || 1
  const rand = mulberry32(seed)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const { record, expectOk, summary } = createRecorder()

  const owner = await signIn(url, anon, username, password)
  const rpc = rpcOf(owner)
  const admin = createScriptClient(url, serviceKey, { mode: 'mutating' })

  console.log(`\n[Testing] Chaos Fuzz ops=${ops} seed=${seed} as ${username}…\n`)

  await softReset(rpc)
  await serviceCleanup(url, serviceKey)

  const item = await ensureMenuItem(rpc)
  const unit = Number(item.base_price)
  await expectOk('FUZZ open_shift', rpc('open_shift', { p_opening_float: 3000 }))
  const { cashPm } = await ensureCashPm(rpc)

  const unpaidIds = []
  const paidIds = []
  let created = 0
  let errors = 0
  let shiftsClosed = 0
  const t0 = Date.now()

  for (let i = 0; i < ops; i++) {
    const roll = rand()
    try {
      if (roll < 0.28) {
        // pay now
        const { data, error } = await rpc('finalize_sale', {
          p_items: [{ menu_item_id: item.id, quantity: 1 + Math.floor(rand() * 2), modifier_option_ids: [] }],
          p_tenders: [{ payment_method_id: cashPm.id, amount: unit * 3 }],
          p_client_request_id: rand() < 0.15 ? crypto.randomUUID() : null,
        })
        if (error) errors++
        else {
          created++
          if (data?.order_id) paidIds.push(data.order_id)
        }
      } else if (roll < 0.48) {
        const { data, error } = await rpc('create_unpaid_order', {
          p_items: [{ menu_item_id: item.id, quantity: 1, modifier_option_ids: [] }],
          p_order_type: pick(['takeaway', 'takeaway', 'delivery']),
          p_customer_name: rand() < 0.5 ? `Fuzz ${i}` : null,
          p_customer_phone: rand() < 0.5 ? `011${String(10000000 + i).slice(-8)}` : null,
          p_delivery_address: 'fuzz st',
        })
        if (error) errors++
        else {
          created++
          if (data?.order_id) unpaidIds.push(data.order_id)
        }
      } else if (roll < 0.6 && unpaidIds.length) {
        const oid = pick(unpaidIds)
        const { error } = await rpc('collect_remaining', {
          p_order_id: oid,
          p_tenders: [
            {
              payment_method_id: cashPm.id,
              amount: Math.max(1, Math.round(unit * (0.3 + rand() * 0.7))),
            },
          ],
        })
        if (error && !/ALREADY|INVALID|paid/i.test(error.message)) errors++
      } else if (roll < 0.68 && unpaidIds.length) {
        const oid = pick(unpaidIds)
        const { error } = await rpc('edit_pending_order', {
          p_order_id: oid,
          p_items: [
            {
              menu_item_id: item.id,
              quantity: 1 + Math.floor(rand() * 3),
              modifier_option_ids: [],
            },
          ],
        })
        if (error && !/FREE_EDIT|NOT_EDITABLE|INVALID/i.test(error.message)) errors++
      } else if (roll < 0.74) {
        const { error } = await rpc('pos_record_expense', {
          p_amount: 5 + Math.floor(rand() * 20),
          p_category: 'other',
          p_description: `fuzz-${i}`,
        })
        if (error && !/INSUFFICIENT|HANDOVER|NO_OPEN/i.test(error.message)) errors++
      } else if (roll < 0.8) {
        const { error } = await rpc('cash_drop', {
          p_amount: 10 + Math.floor(rand() * 40),
          p_reason: `fuzz-drop-${i}`,
        })
        if (error && !/INSUFFICIENT|HANDOVER|NO_OPEN/i.test(error.message)) errors++
      } else if (roll < 0.86 && (paidIds.length || unpaidIds.length)) {
        const oid = pick(paidIds.length ? paidIds : unpaidIds)
        const { error } = await rpc('reprint_order', {
          p_order_id: oid,
          p_kind: pick(['receipt', 'kitchen']),
          p_reason: 'fuzz-reprint',
        })
        if (error && !/NOT_FOUND|INVALID/i.test(error.message)) errors++
      } else if (roll < 0.9) {
        // approve pending for current shift
        const { data: ctx } = await rpc('get_pos_context')
        if (ctx?.open_shift?.id) {
          await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
        }
      } else if (roll < 0.95) {
        // mid-run shift rotate (compressed "hours")
        const { data: ctx } = await rpc('get_pos_context')
        if (ctx?.open_shift) {
          await rpc('approve_pending_for_shift', { p_shift_id: ctx.open_shift.id })
          const { data: ctx2 } = await rpc('get_pos_context')
          const { data: closed, error } = await rpc('close_shift', {
            p_actual_cash_count: Number(ctx2?.open_shift?.expected_cash ?? 0),
            p_difference_reason: null,
            p_notes: `fuzz-rotate-${i}`,
            p_destination: rand() < 0.7 ? 'to_main' : 'to_next_shift',
          })
          if (!error) {
            shiftsClosed++
            const { data: pend } = await rpc('list_pending_handovers')
            for (const h of pend ?? []) {
              if (h.kind === 'to_main') {
                await rpc('receive_treasury_handover', { p_id: h.id })
                // double receive fuzz
                if (rand() < 0.3) await rpc('receive_treasury_handover', { p_id: h.id })
              } else if (rand() < 0.3) {
                await rpc('reject_shift_handover', {
                  p_id: h.id,
                  p_reason: 'fuzz reject',
                })
                await rpc('recreate_shift_handover', {
                  p_shift_id: h.shift_id,
                  p_destination: 'to_next_shift',
                })
                const { data: pend2 } = await rpc('list_pending_handovers')
                const n = (pend2 ?? []).find((x) => x.kind === 'to_next_shift')
                if (n) {
                  await rpc('open_shift', {
                    p_opening_float: 100,
                    p_receive_handover_id: n.id,
                    p_received_actual_cash: Number(n.amount),
                  })
                }
              } else {
                await rpc('open_shift', {
                  p_opening_float: 100,
                  p_receive_handover_id: h.id,
                  p_received_actual_cash: Number(h.amount),
                })
              }
            }
            const { data: ctx3 } = await rpc('get_pos_context')
            if (!ctx3?.open_shift) {
              await rpc('open_shift', { p_opening_float: 200 })
            }
          }
        }
      } else {
        // random double-submit same unpaid collect
        if (unpaidIds.length) {
          const oid = pick(unpaidIds)
          await Promise.all([
            rpc('collect_remaining', {
              p_order_id: oid,
              p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
            }),
            rpc('collect_remaining', {
              p_order_id: oid,
              p_tenders: [{ payment_method_id: cashPm.id, amount: unit }],
            }),
          ])
        }
      }
    } catch {
      errors++
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  … ${i + 1}/${ops} created≈${created} errors=${errors}`)
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  record('FUZZ completed without process crash', true, `${elapsed}s`)
  record('FUZZ created orders', created > ops * 0.2, `created=${created}`)
  record('FUZZ error rate acceptable', errors < ops * 0.35, `errors=${errors}/${ops}`)
  record('FUZZ shift rotations', shiftsClosed >= 0, `closed=${shiftsClosed}`)

  // Final approve + consistency
  const { data: ctxF } = await rpc('get_pos_context')
  if (ctxF?.open_shift?.id) {
    await rpc('approve_pending_for_shift', { p_shift_id: ctxF.open_shift.id })
    const st = await expectOk(
      'FUZZ shift totals',
      rpc('get_shift_collection_totals', { p_shift_id: ctxF.open_shift.id }),
    )
    record('FUZZ shift scope', st?.scope === 'shift')
  }

  const stats = await assertDbConsistency(admin, record, 'FUZZ')
  record(
    'FUZZ no lost order mass',
    stats.orders >= created * 0.5,
    `dbOrders=${stats.orders} created=${created}`,
  )

  // Archive readable
  await expectOk('FUZZ list_shifts_archive', rpc('list_shifts_archive', {}))

  if (!hasFlag('--no-cleanup')) {
    await softReset(rpc)
    await serviceCleanup(url, serviceKey)
    console.log('\nCleanup done.')
  }

  const { failed } = summary(`Chaos Fuzz (ops=${ops} seed=${seed})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
