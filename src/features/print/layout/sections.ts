/** Document-type layout SSOT — sections + fields + order. */

import {
  defaultLabelArForField,
  defaultLabelEnForField,
} from '@/features/print/layout/default-field-labels'

export const PRINT_DOCUMENT_TYPES = ['receipt', 'kitchen'] as const
export type PrintDocumentType = (typeof PRINT_DOCUMENT_TYPES)[number]

export const SECTION_ALIGNS = ['right', 'center', 'left'] as const
export type SectionAlign = (typeof SECTION_ALIGNS)[number]

export const FIELD_LABEL_MODES = ['ar', 'en', 'both', 'none'] as const
export type FieldLabelMode = (typeof FIELD_LABEL_MODES)[number]

export const FIELD_VALUE_FORMATS = ['default', 'number_only'] as const
export type FieldValueFormat = (typeof FIELD_VALUE_FORMATS)[number]

export type FieldStyle = {
  visible: boolean
  font_pt: number
  align: SectionAlign
  bold: boolean
  /** Arabic label from template; "" = no AR prefix (Bridge never invents copy) */
  label_ar?: string
  /** English label from template (optional) */
  label_en?: string
  /** Which label(s) to print — default ar */
  label_mode?: FieldLabelMode
  /** Reference formatting — default full (ORD-000125) */
  value_format?: FieldValueFormat
}

export type SectionStyle = {
  visible: boolean
  font_pt: number
  align: SectionAlign
  bold: boolean
  space_before: number
  space_after: number
  fields: Record<string, FieldStyle>
}

export type DocumentLayout = {
  version: 2
  paper_width_mm: 58 | 80
  section_order: string[]
  sections: Record<string, SectionStyle>
}

export type FieldDef = { id: string; labelKey: string }

/** Visual groups in the designer (reorder still per-section). */
export const PRINT_FIELD_GROUPS = [
  'restaurant',
  'order',
  'customer',
  'lines',
  'totals',
  'payment',
  'ops',
  'other',
] as const
export type PrintFieldGroup = (typeof PRINT_FIELD_GROUPS)[number]

export type SectionDef = {
  id: string
  labelKey: string
  group: PrintFieldGroup
  fields: FieldDef[]
}

function f(
  visible: boolean,
  font_pt: number,
  align: SectionAlign,
  bold: boolean,
): FieldStyle {
  return { visible, font_pt, align, bold }
}

function s(
  visible: boolean,
  font_pt: number,
  align: SectionAlign,
  bold: boolean,
  space_before: number,
  space_after: number,
  fields: Record<string, FieldStyle>,
): SectionStyle {
  return { visible, font_pt, align, bold, space_before, space_after, fields }
}

export const RECEIPT_SECTIONS: SectionDef[] = [
  {
    id: 'restaurant_name',
    labelKey: 'restaurant_name',
    group: 'restaurant',
    fields: [{ id: 'name', labelKey: 'name' }],
  },
  {
    id: 'slogan',
    labelKey: 'slogan',
    group: 'restaurant',
    fields: [{ id: 'text', labelKey: 'slogan_text' }],
  },
  {
    id: 'branch_info',
    labelKey: 'branch_info',
    group: 'restaurant',
    fields: [
      { id: 'address', labelKey: 'address' },
      { id: 'phone', labelKey: 'phone' },
    ],
  },
  {
    id: 'invoice_meta',
    labelKey: 'invoice_meta',
    group: 'order',
    fields: [
      { id: 'invoice_number', labelKey: 'invoice_number' },
      { id: 'order_reference', labelKey: 'order_reference' },
      { id: 'order_type', labelKey: 'order_type' },
      { id: 'created_by_name', labelKey: 'created_by_name' },
      { id: 'last_edited_by_name', labelKey: 'last_edited_by_name' },
      { id: 'collected_by_name', labelKey: 'collected_by_name' },
      { id: 'created_at', labelKey: 'created_at' },
      { id: 'last_edited_at', labelKey: 'last_edited_at' },
      { id: 'collected_at', labelKey: 'collected_at' },
      { id: 'printed_at', labelKey: 'printed_at' },
    ],
  },
  {
    id: 'customer',
    labelKey: 'customer',
    group: 'customer',
    fields: [
      { id: 'customer_name', labelKey: 'customer_name' },
      { id: 'customer_phone', labelKey: 'customer_phone' },
      { id: 'delivery_zone', labelKey: 'delivery_zone' },
      { id: 'delivery_address', labelKey: 'delivery_address' },
      { id: 'delivery_notes', labelKey: 'delivery_notes' },
      { id: 'driver_name', labelKey: 'driver_name' },
      { id: 'table_ref', labelKey: 'table_ref' },
    ],
  },
  {
    id: 'lines',
    labelKey: 'lines',
    group: 'lines',
    fields: [
      { id: 'item_line', labelKey: 'item_line' },
      { id: 'price', labelKey: 'price' },
      { id: 'modifiers', labelKey: 'modifiers' },
      { id: 'note', labelKey: 'line_note' },
    ],
  },
  {
    id: 'totals',
    labelKey: 'totals',
    group: 'totals',
    fields: [
      { id: 'subtotal', labelKey: 'subtotal' },
      { id: 'discount', labelKey: 'discount' },
      { id: 'tax', labelKey: 'tax' },
      { id: 'total', labelKey: 'total' },
    ],
  },
  {
    id: 'payment',
    labelKey: 'payment',
    group: 'payment',
    fields: [
      { id: 'payment_lines', labelKey: 'payment_lines' },
      { id: 'method', labelKey: 'payment_method' },
      { id: 'status', labelKey: 'payment_status' },
      { id: 'change', labelKey: 'change' },
    ],
  },
  {
    id: 'ops',
    labelKey: 'ops',
    group: 'ops',
    fields: [
      { id: 'shift_reference', labelKey: 'shift_reference' },
      { id: 'branch_name', labelKey: 'branch_name' },
      { id: 'device_name', labelKey: 'device_name' },
    ],
  },
  {
    id: 'qr',
    labelKey: 'qr',
    group: 'other',
    fields: [{ id: 'code', labelKey: 'qr_code' }],
  },
  {
    id: 'thank_you',
    labelKey: 'thank_you',
    group: 'other',
    fields: [{ id: 'message', labelKey: 'thank_you_message' }],
  },
]

export const KITCHEN_SECTIONS: SectionDef[] = [
  {
    id: 'restaurant_name',
    labelKey: 'restaurant_name',
    group: 'restaurant',
    fields: [{ id: 'name', labelKey: 'name' }],
  },
  {
    id: 'ticket_header',
    labelKey: 'ticket_header',
    group: 'other',
    fields: [{ id: 'title', labelKey: 'ticket_title' }],
  },
  {
    id: 'order_meta',
    labelKey: 'order_meta',
    group: 'order',
    fields: [
      { id: 'order_reference', labelKey: 'order_reference' },
      { id: 'kitchen_ticket', labelKey: 'kitchen_ticket' },
      { id: 'order_type', labelKey: 'order_type' },
      { id: 'created_by_name', labelKey: 'created_by_name' },
      { id: 'created_at', labelKey: 'created_at' },
      { id: 'printed_at', labelKey: 'printed_at' },
    ],
  },
  {
    id: 'customer_or_table',
    labelKey: 'customer_or_table',
    group: 'customer',
    fields: [
      { id: 'table_ref', labelKey: 'table_ref' },
      { id: 'customer_name', labelKey: 'customer_name' },
      { id: 'customer_phone', labelKey: 'customer_phone' },
      { id: 'delivery_zone', labelKey: 'delivery_zone' },
      { id: 'delivery_address', labelKey: 'delivery_address' },
      { id: 'driver_name', labelKey: 'driver_name' },
    ],
  },
  {
    id: 'lines',
    labelKey: 'lines',
    group: 'lines',
    fields: [
      { id: 'item_line', labelKey: 'item_line' },
      { id: 'modifiers', labelKey: 'modifiers' },
      { id: 'note', labelKey: 'line_note' },
    ],
  },
  {
    id: 'order_note',
    labelKey: 'order_note',
    group: 'other',
    fields: [{ id: 'note', labelKey: 'order_note_text' }],
  },
  {
    id: 'thank_you',
    labelKey: 'thank_you',
    group: 'other',
    fields: [{ id: 'message', labelKey: 'thank_you_message' }],
  },
]

export function sectionsForDocumentType(type: PrintDocumentType): SectionDef[] {
  return type === 'kitchen' ? KITCHEN_SECTIONS : RECEIPT_SECTIONS
}

export function sectionDef(
  type: PrintDocumentType,
  id: string,
): SectionDef | undefined {
  return sectionsForDocumentType(type).find((s) => s.id === id)
}

function inheritFields(
  sectionFont: number,
  sectionAlign: SectionAlign,
  sectionBold: boolean,
  defs: FieldDef[],
  overrides?: Partial<Record<string, Partial<FieldStyle>>>,
): Record<string, FieldStyle> {
  const out: Record<string, FieldStyle> = {}
  for (const d of defs) {
    const o = overrides?.[d.id]
    const labelAr =
      o?.label_ar ?? defaultLabelArForField(d.id, d.labelKey)
    const labelEn =
      o?.label_en ?? defaultLabelEnForField(d.id, d.labelKey)
    out[d.id] = {
      visible: o?.visible ?? true,
      font_pt: o?.font_pt ?? sectionFont,
      align: o?.align ?? sectionAlign,
      bold: o?.bold ?? sectionBold,
      label_ar: labelAr,
      ...(labelEn ? { label_en: labelEn } : {}),
      label_mode: o?.label_mode ?? 'ar',
      ...(o?.value_format ? { value_format: o.value_format } : {}),
    }
  }
  return out
}

/** Ensure every field carries template labels (WYSIWYG / Bridge has no hardcoded copy). */
export function withDefaultFieldLabels(
  fieldId: string,
  labelKey: string,
  field: FieldStyle,
): FieldStyle {
  const next = { ...field }
  if (next.label_ar === undefined) {
    next.label_ar = defaultLabelArForField(fieldId, labelKey)
  }
  if (next.label_en === undefined) {
    const en = defaultLabelEnForField(fieldId, labelKey)
    if (en) next.label_en = en
  }
  if (next.label_mode === undefined) next.label_mode = 'ar'
  return next
}

export function defaultLayoutFor(type: PrintDocumentType): DocumentLayout {
  const defs = sectionsForDocumentType(type)
  if (type === 'kitchen') {
    const sections: Record<string, SectionStyle> = {
      restaurant_name: s(
        true,
        26,
        'center',
        true,
        0,
        2,
        inheritFields(26, 'center', true, defs.find((d) => d.id === 'restaurant_name')!.fields),
      ),
      ticket_header: s(
        true,
        18,
        'center',
        true,
        0,
        2,
        inheritFields(18, 'center', true, defs.find((d) => d.id === 'ticket_header')!.fields),
      ),
      order_meta: s(
        true,
        17,
        'right',
        true,
        0,
        2,
        inheritFields(17, 'right', true, defs.find((d) => d.id === 'order_meta')!.fields, {
          created_at: { bold: false, font_pt: 15 },
          printed_at: { visible: false, bold: false, font_pt: 15 },
          created_by_name: { bold: false },
          order_type: { bold: false },
        }),
      ),
      customer_or_table: s(
        true,
        17,
        'right',
        true,
        0,
        2,
        inheritFields(17, 'right', true, defs.find((d) => d.id === 'customer_or_table')!.fields, {
          delivery_address: { visible: false },
          customer_phone: { bold: false },
          delivery_zone: { bold: false },
          driver_name: { bold: false },
        }),
      ),
      lines: s(
        true,
        22,
        'right',
        true,
        2,
        2,
        inheritFields(22, 'right', true, defs.find((d) => d.id === 'lines')!.fields, {
          modifiers: { font_pt: 16, bold: false },
          note: { font_pt: 16, bold: false },
        }),
      ),
      order_note: s(
        true,
        17,
        'right',
        true,
        2,
        2,
        inheritFields(17, 'right', true, defs.find((d) => d.id === 'order_note')!.fields),
      ),
      thank_you: s(
        true,
        16,
        'center',
        true,
        2,
        4,
        inheritFields(16, 'center', true, defs.find((d) => d.id === 'thank_you')!.fields),
      ),
    }
    return {
      version: 2,
      paper_width_mm: 80,
      section_order: defs.map((d) => d.id),
      sections,
    }
  }

  const sections: Record<string, SectionStyle> = {
    restaurant_name: s(
      true,
      30,
      'center',
      true,
      0,
      2,
      inheritFields(30, 'center', true, defs.find((d) => d.id === 'restaurant_name')!.fields),
    ),
    slogan: s(
      true,
      14,
      'center',
      false,
      0,
      2,
      inheritFields(14, 'center', false, defs.find((d) => d.id === 'slogan')!.fields),
    ),
    branch_info: s(
      true,
      14,
      'center',
      false,
      0,
      2,
      inheritFields(14, 'center', false, defs.find((d) => d.id === 'branch_info')!.fields, {
        phone: { bold: true },
      }),
    ),
    invoice_meta: s(
      true,
      16,
      'right',
      true,
      0,
      2,
      inheritFields(16, 'right', true, defs.find((d) => d.id === 'invoice_meta')!.fields, {
        order_reference: { visible: false },
        created_at: { bold: false, font_pt: 14 },
        last_edited_at: { visible: false, bold: false, font_pt: 14 },
        collected_at: { bold: false, font_pt: 14 },
        printed_at: { visible: false, bold: false, font_pt: 14 },
        created_by_name: { bold: false },
        last_edited_by_name: { visible: false, bold: false },
        collected_by_name: { bold: false },
        order_type: { bold: false },
      }),
    ),
    customer: s(
      true,
      16,
      'right',
      false,
      0,
      2,
      inheritFields(16, 'right', false, defs.find((d) => d.id === 'customer')!.fields, {
        table_ref: { bold: true },
      }),
    ),
    lines: s(
      true,
      17,
      'right',
      true,
      2,
      2,
      inheritFields(17, 'right', true, defs.find((d) => d.id === 'lines')!.fields, {
        modifiers: { font_pt: 14, bold: false },
        note: { font_pt: 14, bold: false },
      }),
    ),
    totals: s(
      true,
      22,
      'center',
      true,
      4,
      2,
      inheritFields(22, 'center', true, defs.find((d) => d.id === 'totals')!.fields, {
        subtotal: { font_pt: 15, bold: false },
        discount: { font_pt: 15, bold: false },
      }),
    ),
    payment: s(
      true,
      15,
      'right',
      true,
      2,
      2,
      inheritFields(15, 'right', true, defs.find((d) => d.id === 'payment')!.fields, {
        method: { visible: false, align: 'center' },
        status: { align: 'center' },
        change: { align: 'center' },
      }),
    ),
    ops: s(
      true,
      14,
      'right',
      false,
      2,
      2,
      inheritFields(14, 'right', false, defs.find((d) => d.id === 'ops')!.fields, {
        shift_reference: { visible: false },
        branch_name: { visible: false },
        device_name: { visible: false },
      }),
    ),
    qr: s(
      false,
      14,
      'center',
      false,
      2,
      2,
      inheritFields(14, 'center', false, defs.find((d) => d.id === 'qr')!.fields),
    ),
    thank_you: s(
      true,
      16,
      'center',
      true,
      2,
      2,
      inheritFields(16, 'center', true, defs.find((d) => d.id === 'thank_you')!.fields),
    ),
  }
  return {
    version: 2,
    paper_width_mm: 80,
    section_order: defs.map((d) => d.id),
    sections,
  }
}

function mergeField(
  base: FieldStyle,
  patch: Partial<FieldStyle> | null | undefined,
): FieldStyle {
  if (!patch || typeof patch !== 'object') return base
  const next: FieldStyle = {
    visible: typeof patch.visible === 'boolean' ? patch.visible : base.visible,
    font_pt: clampInt(patch.font_pt, 10, 40, base.font_pt),
    align: isAlign(patch.align) ? patch.align : base.align,
    bold: typeof patch.bold === 'boolean' ? patch.bold : base.bold,
  }
  if (typeof patch.label_ar === 'string') next.label_ar = patch.label_ar
  else if (base.label_ar !== undefined) next.label_ar = base.label_ar

  if (typeof patch.label_en === 'string') next.label_en = patch.label_en
  else if (base.label_en !== undefined) next.label_en = base.label_en

  if (
    patch.label_mode === 'ar' ||
    patch.label_mode === 'en' ||
    patch.label_mode === 'both' ||
    patch.label_mode === 'none'
  ) {
    next.label_mode = patch.label_mode
  } else if (base.label_mode) {
    next.label_mode = base.label_mode
  }

  if (patch.value_format === 'default' || patch.value_format === 'number_only') {
    next.value_format = patch.value_format
  } else if (base.value_format) {
    next.value_format = base.value_format
  }

  return next
}

export function mergeLayout(
  type: PrintDocumentType,
  incoming: Partial<DocumentLayout> | null | undefined,
): DocumentLayout {
  const base = defaultLayoutFor(type)
  if (!incoming || typeof incoming !== 'object') return base

  const normalized = normalizeLegacyFields(incoming)
  const defs = sectionsForDocumentType(type)
  const known = new Set(defs.map((d) => d.id))
  let order: string[] = Array.isArray(normalized.section_order)
    ? normalized.section_order.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [...base.section_order]
  for (const id of base.section_order) {
    if (!order.includes(id)) order.push(id)
  }

  const sections: Record<string, SectionStyle> = {}
  const raw = normalized.sections ?? {}
  for (const def of defs) {
    const cur = base.sections[def.id]!
    const patch = raw[def.id] as Partial<SectionStyle> | undefined
    if (!patch || typeof patch !== 'object') {
      sections[def.id] = cur
      continue
    }
    const font = clampInt(patch.font_pt, 10, 40, cur.font_pt)
    const align = isAlign(patch.align) ? patch.align : cur.align
    const bold = typeof patch.bold === 'boolean' ? patch.bold : cur.bold
    const fields: Record<string, FieldStyle> = {}
    const rawFields =
      patch.fields && typeof patch.fields === 'object' ? patch.fields : {}
    for (const fd of def.fields) {
      fields[fd.id] = withDefaultFieldLabels(
        fd.id,
        fd.labelKey,
        mergeField(
          cur.fields[fd.id] ?? f(true, font, align, bold),
          rawFields[fd.id] as Partial<FieldStyle> | undefined,
        ),
      )
    }
    sections[def.id] = {
      visible: typeof patch.visible === 'boolean' ? patch.visible : cur.visible,
      font_pt: font,
      align,
      bold,
      space_before: clampInt(patch.space_before, 0, 12, cur.space_before),
      space_after: clampInt(patch.space_after, 0, 12, cur.space_after),
      fields,
    }
  }

  const paper =
    normalized.paper_width_mm === 58 || normalized.paper_width_mm === 80
      ? normalized.paper_width_mm
      : base.paper_width_mm

  return { version: 2, paper_width_mm: paper, section_order: order, sections }
}

/** Map legacy cashier/datetime fields into created_by_name / printed_at. */
function normalizeLegacyFields(
  incoming: Partial<DocumentLayout>,
): Partial<DocumentLayout> {
  const sections = incoming.sections
  if (!sections || typeof sections !== 'object') return incoming
  const nextSections: Record<string, SectionStyle> = { ...(sections as Record<string, SectionStyle>) }
  for (const secId of ['invoice_meta', 'order_meta'] as const) {
    const sec = nextSections[secId]
    if (!sec?.fields) continue
    const fields = { ...sec.fields }
    if (fields.cashier && !fields.created_by_name) {
      const c = { ...fields.cashier }
      if (!c.label_ar || c.label_ar === 'كاشير' || c.label_ar === 'الكاشير') {
        c.label_ar = 'أنشأ الطلب'
        c.label_en = c.label_en || 'Created by'
      }
      fields.created_by_name = c
    }
    delete fields.cashier
    if (fields.datetime && !fields.printed_at) {
      const d = { ...fields.datetime }
      if (!d.label_ar) {
        d.label_ar = 'وقت الطباعة'
        d.label_en = d.label_en || 'Printed at'
      }
      fields.printed_at = d
    }
    delete fields.datetime
    nextSections[secId] = { ...sec, fields }
  }
  return { ...incoming, sections: nextSections }
}

export function moveSection(
  layout: DocumentLayout,
  sectionId: string,
  direction: -1 | 1,
): DocumentLayout {
  const order = [...layout.section_order]
  const i = order.indexOf(sectionId)
  if (i < 0) return layout
  const j = i + direction
  if (j < 0 || j >= order.length) return layout
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { ...layout, section_order: order }
}

export function fieldStyle(
  section: SectionStyle | null | undefined,
  fieldId: string,
): FieldStyle | null {
  if (!section || !section.visible) return null
  const field = section.fields?.[fieldId]
  if (!field || !field.visible) return null
  return field
}

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function isAlign(v: unknown): v is SectionAlign {
  return v === 'right' || v === 'center' || v === 'left'
}
