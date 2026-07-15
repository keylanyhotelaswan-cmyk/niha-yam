/**
 * Order cancel eligibility regressions.
 *   pnpm test:order-cancel
 */
import { evaluateOrderCancel } from '../src/features/orders/utils/cancelOrder.ts'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\nOrder cancel eligibility regressions…\n')

record(
  'Cashier: unpaid takeaway (auto-delivered) → allow',
  evaluateOrderCancel({
    fulfillmentStatus: 'delivered',
    paymentStatus: 'unpaid',
    orderType: 'takeaway',
    collectedAmount: 0,
    isManager: false,
  }).allowed === true,
)

record(
  'Cashier: unpaid dine_in new → allow',
  evaluateOrderCancel({
    fulfillmentStatus: 'new',
    paymentStatus: 'unpaid',
    orderType: 'dine_in',
    collectedAmount: 0,
    isManager: false,
  }).allowed === true,
)

record(
  'Cashier without override: unpaid delivery preparing → block kitchen',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'preparing',
      paymentStatus: 'unpaid',
      orderType: 'delivery',
      collectedAmount: 0,
      isManager: false,
    })
    return r.allowed === false && r.code === 'CANCEL_BLOCKED_IN_PROGRESS'
  })(),
)

record(
  'Manager: unpaid delivery preparing → allow override',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'preparing',
      paymentStatus: 'unpaid',
      orderType: 'delivery',
      collectedAmount: 0,
      isManager: true,
    })
    return r.allowed === true && r.managerOverride === true
  })(),
)

record(
  'Paid takeaway → block collected',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'delivered',
      paymentStatus: 'paid',
      orderType: 'takeaway',
      collectedAmount: 120,
      isManager: true,
    })
    return r.allowed === false && r.code === 'CANCEL_BLOCKED_COLLECTED'
  })(),
)

record(
  'Partial collection → block partial',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'new',
      paymentStatus: 'partial',
      orderType: 'delivery',
      collectedAmount: 50,
      isManager: true,
    })
    return r.allowed === false && r.code === 'CANCEL_BLOCKED_PARTIAL'
  })(),
)

record(
  'Delivery delivered → block delivered',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'delivered',
      paymentStatus: 'unpaid',
      orderType: 'delivery',
      collectedAmount: 0,
      isManager: true,
    })
    return r.allowed === false && r.code === 'CANCEL_BLOCKED_DELIVERED'
  })(),
)

record(
  'Already cancelled → block',
  (() => {
    const r = evaluateOrderCancel({
      fulfillmentStatus: 'cancelled',
      paymentStatus: 'unpaid',
      orderType: 'takeaway',
      collectedAmount: 0,
      isManager: true,
    })
    return r.allowed === false && r.code === 'ALREADY_CANCELLED'
  })(),
)

record(
  'Manager unpaid ready → allow',
  evaluateOrderCancel({
    fulfillmentStatus: 'ready',
    paymentStatus: 'unpaid',
    orderType: 'dine_in',
    collectedAmount: 0,
    isManager: true,
  }).allowed === true,
)

record(
  'Cashier unpaid ready → block',
  evaluateOrderCancel({
    fulfillmentStatus: 'ready',
    paymentStatus: 'unpaid',
    orderType: 'dine_in',
    collectedAmount: 0,
    isManager: false,
  }).code === 'CANCEL_BLOCKED_IN_PROGRESS',
)

const failed = results.filter((r) => !r.ok)
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`)
if (failed.length) process.exit(1)
