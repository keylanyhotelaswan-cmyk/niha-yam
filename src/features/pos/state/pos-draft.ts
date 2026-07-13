import type { CartLine } from '@/features/pos/types'
import type { PosOrderType } from '@/features/orders/types'
import {
  parseHeldDraftsJson,
  upsertHeldDraft,
} from '@/features/pos/state/held-drafts'

export type PosPayMode = 'now' | 'later'

export type PosDraft = {
  id: string
  localRef: string
  orderType: PosOrderType
  payMode: PosPayMode
  customerMode: 'walkin' | 'pick' | 'new'
  customerId: string | null
  customerName: string
  customerPhone: string
  deliveryAddress: string
  deliveryZone: string
  dineInTableRef: string
  deliveryDriverId: string | null
  orderNote: string
  lines: CartLine[]
  heldAt: string | null
}

const HELD_KEY = 'pos.heldDrafts.v1'

export { draftHasWork, upsertHeldDraft, removeHeldDraft, takeHeldDraft, shouldIgnoreSellDismiss } from '@/features/pos/state/held-drafts'

export function loadHeldDrafts(): PosDraft[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(HELD_KEY)
    return parseHeldDraftsJson(raw) as PosDraft[]
  } catch {
    return []
  }
}

export function saveHeldDrafts(drafts: PosDraft[]) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(HELD_KEY, JSON.stringify(drafts))
}

export function createEmptyDraft(
  partial: Omit<PosDraft, 'id' | 'localRef' | 'lines' | 'heldAt'>,
): PosDraft {
  const n = Date.now().toString(36).slice(-4).toUpperCase()
  const {
    customerId = null,
    deliveryZone = '',
    dineInTableRef = '',
    deliveryDriverId = null,
    ...rest
  } = partial
  return {
    ...rest,
    customerId,
    deliveryZone,
    dineInTableRef,
    deliveryDriverId,
    id: crypto.randomUUID(),
    localRef: `DRAFT-${n}`,
    lines: [],
    heldAt: null,
  }
}

export function orderMetaFromDraft(draft: PosDraft) {
  const hasCustomer = Boolean(draft.customerPhone?.trim())
  return {
    orderType: draft.orderType,
    customerId: hasCustomer ? draft.customerId : null,
    customerName: hasCustomer ? draft.customerName || null : null,
    customerPhone: hasCustomer ? draft.customerPhone || null : null,
    deliveryAddress:
      draft.orderType === 'delivery' ? draft.deliveryAddress || null : null,
    deliveryZone:
      draft.orderType === 'delivery' ? draft.deliveryZone || null : null,
    orderNote: draft.orderNote || null,
    dineInTableRef:
      draft.orderType === 'dine_in' ? draft.dineInTableRef || null : null,
    deliveryDriverId:
      draft.orderType === 'delivery' ? draft.deliveryDriverId : null,
  }
}

/** Park an active draft into the held list (dedupe by id). */
export function parkDraft(list: PosDraft[], draft: PosDraft): PosDraft[] {
  return upsertHeldDraft(list, {
    ...draft,
    heldAt: draft.heldAt ?? new Date().toISOString(),
  })
}
