/**
 * Unit tests for POS held-draft helpers (no Supabase).
 *
 *   node --experimental-strip-types scripts/test-pos-hold.ts
 */
import assert from 'node:assert/strict'
import {
  draftHasWork,
  normalizeHeldDraft,
  parseHeldDraftsJson,
  removeHeldDraft,
  shouldIgnoreSellDismiss,
  takeHeldDraft,
  upsertHeldDraft,
} from '../src/features/pos/state/held-drafts.ts'

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

const base = {
  id: 'd1',
  localRef: 'DRAFT-1',
  orderType: 'takeaway',
  payMode: 'later',
  customerMode: 'walkin',
  customerId: null,
  customerName: '',
  customerPhone: '',
  deliveryAddress: '',
  deliveryZone: '',
  dineInTableRef: '',
  deliveryDriverId: null,
  orderNote: '',
  lines: [],
  heldAt: null,
}

console.log('POS held-draft tests\n')

test('draftHasWork: empty draft is idle', () => {
  assert.equal(draftHasWork(base), false)
})

test('draftHasWork: lines count as work', () => {
  assert.equal(
    draftHasWork({ ...base, lines: [{ quantity: 1 }] }),
    true,
  )
})

test('draftHasWork: phone-only counts as work', () => {
  assert.equal(draftHasWork({ ...base, customerPhone: '0100' }), true)
})

test('upsertHeldDraft: prepends and dedupes by id', () => {
  const a = { id: 'a', n: 1 }
  const b = { id: 'b', n: 2 }
  const a2 = { id: 'a', n: 3 }
  assert.deepEqual(upsertHeldDraft([b, a], a2), [a2, b])
})

test('takeHeldDraft: removes and returns draft', () => {
  const list = [
    { id: 'a', v: 1 },
    { id: 'b', v: 2 },
  ]
  const { next, draft } = takeHeldDraft(list, 'b')
  assert.deepEqual(draft, { id: 'b', v: 2 })
  assert.deepEqual(next, [{ id: 'a', v: 1 }])
})

test('removeHeldDraft: drops all matching ids', () => {
  assert.deepEqual(
    removeHeldDraft(
      [
        { id: 'a' },
        { id: 'a' },
        { id: 'b' },
      ],
      'a',
    ),
    [{ id: 'b' }],
  )
})

test('shouldIgnoreSellDismiss: payment blocks park-on-outside', () => {
  assert.equal(
    shouldIgnoreSellDismiss({
      paymentOpen: true,
      hasModifierPicker: false,
      hasOpenPrice: false,
      hasLineExtras: false,
    }),
    true,
  )
  assert.equal(
    shouldIgnoreSellDismiss({
      paymentOpen: false,
      hasModifierPicker: false,
      hasOpenPrice: false,
      hasLineExtras: false,
    }),
    false,
  )
})

test('normalizeHeldDraft: drops corrupt rows', () => {
  assert.equal(normalizeHeldDraft(null), null)
  assert.equal(normalizeHeldDraft({ id: 'x' }), null)
  assert.equal(normalizeHeldDraft({ foo: 1 }), null)
})

test('normalizeHeldDraft: repairs missing lines/fields', () => {
  const n = normalizeHeldDraft({
    id: 'ok',
    orderType: 'delivery',
    customerPhone: '010',
    // lines missing
  })
  assert.ok(n)
  assert.equal(n.orderType, 'delivery')
  assert.deepEqual(n.lines, [])
  assert.equal(n.payMode, 'later')
  assert.equal(n.deliveryZone, '')
})

test('normalizeHeldDraft: keeps valid cart lines', () => {
  const n = normalizeHeldDraft({
    id: 'ok',
    orderType: 'takeaway',
    payMode: 'now',
    lines: [
      {
        key: 'l1',
        menuItemId: 'm1',
        name: 'شاي',
        sku: null,
        unitPrice: 10,
        quantity: 2,
        modifierOptionIds: [],
        modifierSummary: '',
        isOpenPrice: false,
      },
      { broken: true },
    ],
  })
  assert.ok(n)
  assert.equal(n.lines.length, 1)
  assert.equal(n.lines[0].name, 'شاي')
  assert.equal(n.payMode, 'now')
})

test('parseHeldDraftsJson: invalid JSON → []', () => {
  assert.deepEqual(parseHeldDraftsJson('{'), [])
  assert.deepEqual(parseHeldDraftsJson(null), [])
})

test('parseHeldDraftsJson: filters bad entries in array', () => {
  const raw = JSON.stringify([
    { id: 'good', orderType: 'dine_in', lines: [] },
    { id: 'bad' },
    null,
  ])
  const list = parseHeldDraftsJson(raw)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'good')
})

test('re-hold same id does not duplicate', () => {
  let held = []
  const d1 = {
    ...base,
    id: 'same',
    heldAt: '2026-01-01T00:00:00.000Z',
    lines: [{ quantity: 1 }],
  }
  held = upsertHeldDraft(held, d1)
  const d2 = {
    ...d1,
    heldAt: '2026-01-02T00:00:00.000Z',
    customerPhone: '011',
  }
  held = upsertHeldDraft(held, d2)
  assert.equal(held.length, 1)
  assert.equal(held[0].customerPhone, '011')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
