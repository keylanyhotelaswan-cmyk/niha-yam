import type {
  OrderFulfillmentStatus,
  OrderPaymentStatus,
  PosOrderType,
} from '@/features/orders/types'

export type CancelBlockCode =
  | 'ALREADY_CANCELLED'
  | 'CANCEL_BLOCKED_COLLECTED'
  | 'CANCEL_BLOCKED_IN_PROGRESS'
  | 'CANCEL_BLOCKED_DELIVERED'
  | 'CANCEL_BLOCKED_PARTIAL'

export type CancelEligibilityInput = {
  fulfillmentStatus: OrderFulfillmentStatus
  paymentStatus: OrderPaymentStatus
  orderType: PosOrderType
  /** Net collected (pending + approved). */
  collectedAmount: number
  /** Actor is owner/manager. */
  isManager: boolean
}

export type CancelEligibility = {
  allowed: boolean
  code: CancelBlockCode | null
  /** Manager-only path (unpaid but kitchen already started). */
  managerOverride?: boolean
}

/**
 * Business rules for soft-cancel (no hard delete):
 * - Unpaid + not started (or takeaway auto-delivered) → allow
 * - Any money collected → block (use reverse/refund path)
 * - Delivery/dine_in preparing|ready → cashier block; manager may cancel if unpaid
 * - Delivery/dine_in delivered → block
 * - Takeaway "delivered" is an auto terminal for takeaway flow, not a delivery handoff
 */
export function evaluateOrderCancel(
  input: CancelEligibilityInput,
): CancelEligibility {
  const collected = Number(input.collectedAmount ?? 0)
  const fulfillment = input.fulfillmentStatus
  const orderType = input.orderType

  if (fulfillment === 'cancelled') {
    return { allowed: false, code: 'ALREADY_CANCELLED' }
  }

  if (collected > 0.001) {
    if (input.paymentStatus === 'partial') {
      return { allowed: false, code: 'CANCEL_BLOCKED_PARTIAL' }
    }
    return { allowed: false, code: 'CANCEL_BLOCKED_COLLECTED' }
  }

  // Takeaway is created as fulfillment=delivered by design — still cancellable while unpaid.
  if (orderType === 'takeaway') {
    return { allowed: true, code: null }
  }

  if (fulfillment === 'delivered') {
    return { allowed: false, code: 'CANCEL_BLOCKED_DELIVERED' }
  }

  if (fulfillment === 'preparing' || fulfillment === 'ready') {
    if (input.isManager) {
      return { allowed: true, code: null, managerOverride: true }
    }
    return { allowed: false, code: 'CANCEL_BLOCKED_IN_PROGRESS' }
  }

  // fulfillment === 'new' (and unpaid)
  return { allowed: true, code: null }
}
