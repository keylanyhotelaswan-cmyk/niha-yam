import type { StaffRole } from '@/shared/types/identity'
import { primaryStaffRole } from '@/features/pos/utils/role'

export type DiscountType = 'amount' | 'percent'

export type DiscountPayload = {
  type: DiscountType
  value: number
  reason: string
} | null

/**
 * Discount capability config — preparatory for per-staff overrides (ADR-0012).
 * Today resolved from role + server `can_discount`; UI mirrors this in staff dialogs.
 */
export type DiscountPermissionConfig = {
  manual: boolean
  typeAmount: boolean
  typePercent: boolean
  maxAmount: number | null
  maxPercent: number | null
  canEdit: boolean
  canRemove: boolean
}

const NONE: DiscountPermissionConfig = {
  manual: false,
  typeAmount: false,
  typePercent: false,
  maxAmount: null,
  maxPercent: null,
  canEdit: false,
  canRemove: false,
}

const FULL: DiscountPermissionConfig = {
  manual: true,
  typeAmount: true,
  typePercent: true,
  maxAmount: null,
  maxPercent: null,
  canEdit: true,
  canRemove: true,
}

/** Role defaults until per-user overrides ship. */
export const DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE: Record<
  StaffRole,
  DiscountPermissionConfig
> = {
  owner: FULL,
  manager: FULL,
  cashier: NONE,
  remote_operator: NONE,
  waiter: NONE,
  kitchen: NONE,
}

export function resolveDiscountPermissions(
  canDiscount: boolean,
  roles: readonly StaffRole[],
): DiscountPermissionConfig {
  if (!canDiscount) return NONE
  const role = primaryStaffRole(roles)
  return DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE[role ?? 'cashier']
}

export function validateDiscountInput(
  config: DiscountPermissionConfig,
  type: DiscountType,
  value: number,
): string | null {
  if (!config.manual) return 'DISCOUNT_NOT_ALLOWED'
  if (type === 'amount' && !config.typeAmount) return 'DISCOUNT_TYPE_NOT_ALLOWED'
  if (type === 'percent' && !config.typePercent) return 'DISCOUNT_TYPE_NOT_ALLOWED'
  if (!(value > 0)) return 'DISCOUNT_REASON_REQUIRED'
  if (type === 'amount' && config.maxAmount != null && value > config.maxAmount) {
    return 'DISCOUNT_MAX_AMOUNT'
  }
  if (type === 'percent' && config.maxPercent != null && value > config.maxPercent) {
    return 'DISCOUNT_MAX_PERCENT'
  }
  return null
}
