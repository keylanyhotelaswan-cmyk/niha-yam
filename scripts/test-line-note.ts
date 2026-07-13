/**
 * Unit tests for smart / labeled line-note helpers.
 *
 *   node --experimental-strip-types scripts/test-line-note.ts
 */
import assert from 'node:assert/strict'
import {
  extractSaucesFromText,
  mergeLineNote,
  normalizeCustomNote,
  setCustomInNote,
  splitLineNote,
  toggleSauceInNote,
} from '../src/features/pos/utils/line-note.ts'

const SAUCES = ['ثوم', 'باربكيو', 'ترياكي']

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

console.log('Line-note labeled helpers\n')

test('normalizeCustomNote: commas and spaces', () => {
  assert.equal(
    normalizeCustomNote('  بدون بصل ,  أقل حار ؛ تقطيع  '),
    'بدون بصل، أقل حار، تقطيع',
  )
})

test('mergeLineNote: sauce-only labeled', () => {
  assert.equal(mergeLineNote(['ثوم'], ''), 'صوص: ثوم')
  assert.equal(
    mergeLineNote(['ثوم', 'باربكيو'], ''),
    'صوص: ثوم، باربكيو',
  )
})

test('mergeLineNote: note-only labeled', () => {
  assert.equal(mergeLineNote([], 'حار'), 'ملاحظة: حار')
})

test('mergeLineNote: both sections', () => {
  assert.equal(
    mergeLineNote(['ثوم', 'باربكيو'], 'حار'),
    'صوص: ثوم، باربكيو · ملاحظة: حار',
  )
})

test('splitLineNote: labeled form', () => {
  const r = splitLineNote('صوص: ثوم، باربكيو · ملاحظة: بدون بصل', SAUCES)
  assert.deepEqual(r.sauces, ['ثوم', 'باربكيو'])
  assert.equal(r.custom, 'بدون بصل')
})

test('splitLineNote: legacy unlabeled still works', () => {
  const r = splitLineNote('ثوم، بدون بصل، باربكيو', SAUCES)
  assert.deepEqual(r.sauces, ['ثوم', 'باربكيو'])
  assert.equal(r.custom, 'بدون بصل')
})

test('extractSaucesFromText: typed sauce names promote', () => {
  const r = extractSaucesFromText('ثوم, بدون بصل', SAUCES)
  assert.deepEqual(r.sauces, ['ثوم'])
  assert.equal(r.custom, 'بدون بصل')
})

test('setCustomInNote: keeps chips, rewrites custom smartly', () => {
  const note = 'صوص: ثوم · ملاحظة: قديمة'
  const next = setCustomInNote(note, 'بدون بصل · أقل حار', SAUCES)
  assert.equal(next, 'صوص: ثوم · ملاحظة: بدون بصل، أقل حار')
})

test('setCustomInNote: typing a sauce name adds chip and replaces custom', () => {
  const next = setCustomInNote('ملاحظة: بدون بصل', 'باربكيو، حار زيادة', SAUCES)
  assert.equal(next, 'صوص: باربكيو · ملاحظة: حار زيادة')
})

test('toggleSauceInNote: add/remove keeps note section', () => {
  const a = toggleSauceInNote('ملاحظة: بدون بصل', 'ثوم', SAUCES)
  assert.equal(a, 'صوص: ثوم · ملاحظة: بدون بصل')
  const b = toggleSauceInNote(a, 'ثوم', SAUCES)
  assert.equal(b, 'ملاحظة: بدون بصل')
})

test('empty custom clears note section only', () => {
  assert.equal(
    setCustomInNote('صوص: ثوم · ملاحظة: قديم', '   ', SAUCES),
    'صوص: ثوم',
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
