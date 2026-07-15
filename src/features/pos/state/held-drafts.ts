/**
 * Pure helpers for POS held (parked) drafts — safe to unit-test without React.
 */

export type HeldDraftWorkFields = {
  lines: ReadonlyArray<{ quantity?: number }>
  customerPhone?: string | null
  customerName?: string | null
  orderNote?: string | null
  deliveryAddress?: string | null
}

export function draftHasWork(draft: HeldDraftWorkFields): boolean {
  return (
    draft.lines.length > 0 ||
    Boolean(draft.customerPhone?.trim()) ||
    Boolean(draft.customerName?.trim()) ||
    Boolean(draft.orderNote?.trim()) ||
    Boolean(draft.deliveryAddress?.trim())
  )
}

/** Insert or replace by id (newest first). */
export function upsertHeldDraft<T extends { id: string }>(
  list: T[],
  draft: T,
): T[] {
  return [draft, ...list.filter((x) => x.id !== draft.id)]
}

export function removeHeldDraft<T extends { id: string }>(
  list: T[],
  id: string,
): T[] {
  return list.filter((x) => x.id !== id)
}

export function takeHeldDraft<T extends { id: string }>(
  list: T[],
  id: string,
): { next: T[]; draft: T | null } {
  const draft = list.find((x) => x.id === id) ?? null
  return { next: removeHeldDraft(list, id), draft }
}

/**
 * True when a dismiss event on the sell dialog should be ignored because a
 * nested overlay (payment / modifiers / extras) owns the interaction.
 */
export function shouldIgnoreSellDismiss(opts: {
  paymentOpen: boolean
  payLaterOpen?: boolean
  hasModifierPicker: boolean
  hasOpenPrice: boolean
  hasLineExtras: boolean
}): boolean {
  return (
    opts.paymentOpen ||
    Boolean(opts.payLaterOpen) ||
    opts.hasModifierPicker ||
    opts.hasOpenPrice ||
    opts.hasLineExtras
  )
}

type NormalizeInput = {
  id?: unknown
  localRef?: unknown
  orderType?: unknown
  payMode?: unknown
  customerMode?: unknown
  customerId?: unknown
  customerName?: unknown
  customerPhone?: unknown
  deliveryAddress?: unknown
  deliveryZone?: unknown
  dineInTableRef?: unknown
  deliveryDriverId?: unknown
  orderNote?: unknown
  lines?: unknown
  heldAt?: unknown
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : null
}

function normalizeLine(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const line = raw as Record<string, unknown>
  if (typeof line.key !== 'string' || typeof line.menuItemId !== 'string') {
    return null
  }
  const quantity = typeof line.quantity === 'number' ? line.quantity : 1
  const unitPrice = typeof line.unitPrice === 'number' ? line.unitPrice : 0
  return {
    ...line,
    quantity: quantity < 1 ? 1 : quantity,
    unitPrice,
    modifierOptionIds: Array.isArray(line.modifierOptionIds)
      ? line.modifierOptionIds.filter((x) => typeof x === 'string')
      : [],
    modifierSummary:
      typeof line.modifierSummary === 'string' ? line.modifierSummary : '',
    name: typeof line.name === 'string' ? line.name : '—',
    sku: typeof line.sku === 'string' || line.sku === null ? line.sku : null,
    isOpenPrice: Boolean(line.isOpenPrice),
  }
}

/** Coerce sessionStorage JSON into a usable held draft; drop corrupt rows. */
export function normalizeHeldDraft(raw: unknown): NormalizeInput | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as NormalizeInput
  if (typeof d.id !== 'string' || !d.id) return null
  const orderType = d.orderType
  if (
    orderType !== 'dine_in' &&
    orderType !== 'takeaway' &&
    orderType !== 'delivery'
  ) {
    return null
  }
  const payMode = d.payMode === 'now' || d.payMode === 'later' ? d.payMode : 'later'
  const linesRaw = Array.isArray(d.lines) ? d.lines : []
  const lines = linesRaw
    .map(normalizeLine)
    .filter((x): x is Record<string, unknown> => x !== null)

  return {
    id: d.id,
    localRef: asString(d.localRef, 'DRAFT'),
    orderType,
    payMode,
    customerMode:
      d.customerMode === 'walkin' ||
      d.customerMode === 'pick' ||
      d.customerMode === 'new'
        ? d.customerMode
        : 'walkin',
    customerId: asNullableString(d.customerId),
    customerName: asString(d.customerName),
    customerPhone: asString(d.customerPhone),
    deliveryAddress: asString(d.deliveryAddress),
    deliveryZone: asString(d.deliveryZone),
    dineInTableRef: asString(d.dineInTableRef),
    deliveryDriverId: asNullableString(d.deliveryDriverId),
    orderNote: asString(d.orderNote),
    lines,
    heldAt: asNullableString(d.heldAt),
  }
}

export function parseHeldDraftsJson(raw: string | null): NormalizeInput[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeHeldDraft)
      .filter((x): x is NormalizeInput => x !== null)
  } catch {
    return []
  }
}
