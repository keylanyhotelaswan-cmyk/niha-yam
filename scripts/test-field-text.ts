/**
 *   node --experimental-strip-types scripts/test-field-text.ts
 */
import assert from 'node:assert/strict'
import {
  composeLabeledText,
  fieldLabelOnly,
  shortReference,
  fieldPrintText,
} from '../src/features/print/layout/field-text.ts'

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  [PASS] ${name}`)
  } catch (e) {
    failed += 1
    console.log(`  [FAIL] ${name} — ${e instanceof Error ? e.message : e}`)
  }
}

console.log('Field-text helpers\n')

test('shortReference strips prefix and zeros', () => {
  assert.equal(shortReference('ORD-000125'), '125')
  assert.equal(shortReference('KT-000087'), '87')
  assert.equal(shortReference('000042'), '42')
})

test('compose: Arabic label from template', () => {
  assert.equal(
    composeLabeledText({ value: 'ORD-000125', labelAr: 'فاتورة' }),
    'فاتورة: ORD-000125',
  )
})

test('compose: number only + no label', () => {
  assert.equal(
    fieldPrintText(
      {
        visible: true,
        font_pt: 14,
        align: 'right',
        bold: true,
        label_ar: '',
        label_mode: 'none',
        value_format: 'number_only',
      },
      'ORD-000125',
    ),
    '125',
  )
})

test('compose: both languages', () => {
  assert.equal(
    composeLabeledText({
      value: '125',
      labelAr: 'فاتورة',
      labelEn: 'Invoice',
      labelMode: 'both',
    }),
    'Invoice / فاتورة: 125',
  )
})

test('compose: English only', () => {
  assert.equal(
    composeLabeledText({
      value: '125',
      labelEn: 'No.',
      labelMode: 'en',
    }),
    'No.: 125',
  )
})

test('fieldLabelOnly: title from template', () => {
  assert.equal(
    fieldLabelOnly({
      visible: true,
      font_pt: 18,
      align: 'center',
      bold: true,
      label_ar: 'تذكرة مطبخ',
      label_mode: 'ar',
    }),
    'تذكرة مطبخ',
  )
})

test('compose: empty label → value only', () => {
  assert.equal(
    composeLabeledText({ value: '125', labelAr: '', labelMode: 'ar' }),
    '125',
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
