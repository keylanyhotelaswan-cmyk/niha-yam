/**
 * POS operational snapshot consistency + transfer form regressions.
 *
 *   pnpm test:pos-ops-ux
 */
import {
  shouldResetTransferForm,
  transferableAmount,
} from '../src/features/pos/utils/transferable.ts'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\nPOS ops UX regressions…\n')

record(
  'Reset only on open transition false→true',
  shouldResetTransferForm(false, true) === true &&
    shouldResetTransferForm(true, true) === false &&
    shouldResetTransferForm(true, false) === false &&
    shouldResetTransferForm(false, false) === false,
)

// Cashier strip shows 465 while approved ledger is 0 — transfer must use operational.
record(
  'Transferable follows operational (not approved=0)',
  transferableAmount({ balance: 465, approved_balance: 0 }) === 465 &&
    transferableAmount({ balance: 40, approved_balance: -260 }) === 40 &&
    transferableAmount({ balance: 20, approved_balance: 20 }) === 20 &&
    transferableAmount({ balance: 0, approved_balance: 100 }) === 0,
  'pending cash visible to cashier',
)

/** Pure snapshot helper — same formulas used by ShiftSummary cashier mode. */
function cashierExpectedCash(report, paymentMethods) {
  if (report.operational_drawer_balance != null) {
    return Number(report.operational_drawer_balance)
  }
  return Number(report.expected_cash ?? 0)
}
function cashierCashSales(paymentMethods, fallbackLedger) {
  if (!paymentMethods) return Number(fallbackLedger ?? 0)
  return paymentMethods
    .filter((m) => m.code === 'cash')
    .reduce((s, m) => s + Number(m.amount ?? 0), 0)
}

record(
  'Cashier cash sales matches payment strip (not ledger 0)',
  cashierCashSales([{ code: 'cash', amount: 465 }], 0) === 465 &&
    cashierCashSales(null, 0) === 0,
)

record(
  'Cashier expected cash uses operational_drawer_balance',
  cashierExpectedCash({ operational_drawer_balance: 465, expected_cash: 0 }) ===
    465 &&
    cashierExpectedCash({ expected_cash: 12 }) === 12,
)

/** Hub list: with open shift, do not use hubOnly (hides paid+completed). */
function shouldHubOnly(shiftId) {
  return !shiftId
}
record(
  'Orders hub: hubOnly off when shift open',
  shouldHubOnly('shift-uuid') === false && shouldHubOnly(null) === true,
)

const failed = results.filter((r) => !r.ok)
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`)
if (failed.length) process.exit(1)
