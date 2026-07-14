/**
 * POS sale polish: discount/net/partial math + transfer reasons.
 *   pnpm test:pos-sale-polish
 */
import {
  computeDiscountAmount,
  netAfterDiscount,
  remainingAfterPartial,
  resolveTransferReason,
} from '../src/features/pos/utils/saleMoney.ts'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const labels = {
  delivery_payment: 'سداد قيمة طلب دليفري',
  collection_transfer: 'تحويل تحصيل',
  payment_method_fix: 'تصحيح وسيلة الدفع',
  shift_settlement: 'تسوية الوردية',
  deposit: 'إيداع',
  withdrawal: 'سحب',
  other: 'سبب آخر',
}

console.log('\nPOS sale polish regressions…\n')

record(
  'Discount amount type',
  computeDiscountAmount(500, true, 'amount', 50) === 50 &&
    netAfterDiscount(500, 50) === 450,
)

record(
  'Discount percent type',
  computeDiscountAmount(500, true, 'percent', 10) === 50 &&
    netAfterDiscount(500, 50) === 450,
)

record(
  'Partial collection after discount',
  remainingAfterPartial(450, 200) === 250 &&
    remainingAfterPartial(450, 450) === 0,
)

record(
  'No discount → net = subtotal',
  computeDiscountAmount(500, false, 'amount', 50) === 0 &&
    netAfterDiscount(500, 0) === 500,
)

record(
  'Transfer reason preset + other',
  resolveTransferReason('delivery_payment', '', labels) ===
    labels.delivery_payment &&
    resolveTransferReason('other', 'تصحيح يدوي', labels) === 'تصحيح يدوي' &&
    resolveTransferReason('other', '  ', labels) === null &&
    resolveTransferReason('', '', labels) === null,
)

const failed = results.filter((r) => !r.ok)
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed.`)
if (failed.length) process.exit(1)
