/** Compose printable field text from layout overrides (labels + number format). */

import type { FieldStyle } from '@/features/print/layout/sections'

export type FieldLabelMode = NonNullable<FieldStyle['label_mode']>
export type FieldValueFormat = NonNullable<FieldStyle['value_format']>

/** ORD-000125 → 125 · KT-000087 → 87 */
export function shortReference(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) return ''
  const m = trimmed.match(/^(?:[A-Za-z]+-)?0*(\d+)$/)
  if (m?.[1]) return m[1]
  const last = trimmed.includes('-')
    ? (trimmed.split('-').pop() ?? trimmed)
    : trimmed
  const stripped = last.replace(/^0+/, '')
  return stripped || '0'
}

export function formatFieldValue(
  raw: string,
  format: FieldValueFormat | undefined,
): string {
  if (!raw) return ''
  if (format === 'number_only') return shortReference(raw)
  return raw
}

/**
 * Build a printable line from value + AR/EN labels from the template only.
 * Bridge/Preview must not inject hardcoded document copy.
 * - label_mode `none` → value only
 * - empty label_ar → value only (no fallback strings in code)
 */
export function composeLabeledText(opts: {
  value: string
  labelAr?: string
  labelEn?: string
  labelMode?: FieldLabelMode
}): string | null {
  const value = opts.value.trim()
  if (!value) return null

  const mode = opts.labelMode ?? 'ar'
  if (mode === 'none') return value

  const ar = (opts.labelAr ?? '').trim()
  const en = (opts.labelEn ?? '').trim()

  let prefix = ''
  if (mode === 'ar') prefix = ar
  else if (mode === 'en') prefix = en || ar
  else if (mode === 'both') {
    if (ar && en) prefix = `${en} / ${ar}`
    else prefix = en || ar
  }

  if (!prefix) return value
  if (/[:：#]$/.test(prefix)) return `${prefix}${value}`
  return `${prefix}: ${value}`
}

/** Label text only (e.g. kitchen ticket title) — template fields, no code defaults. */
export function fieldLabelOnly(field: FieldStyle | null | undefined): string | null {
  if (!field) return null
  const mode = field.label_mode ?? 'ar'
  if (mode === 'none') return null
  const ar = (field.label_ar ?? '').trim()
  const en = (field.label_en ?? '').trim()
  if (mode === 'en') return en || ar || null
  if (mode === 'both') {
    if (ar && en) return `${en} / ${ar}`
    return en || ar || null
  }
  return ar || null
}

export function fieldPrintText(
  field: FieldStyle | null | undefined,
  rawValue: string | null | undefined,
): string | null {
  if (!rawValue?.trim()) return null
  const value = formatFieldValue(rawValue, field?.value_format)
  return composeLabeledText({
    value,
    labelAr: field?.label_ar,
    labelEn: field?.label_en,
    labelMode: field?.label_mode,
  })
}

export const REFERENCE_FIELD_IDS = new Set([
  'invoice_number',
  'order_reference',
  'kitchen_ticket',
])
