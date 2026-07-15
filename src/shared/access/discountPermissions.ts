import type { StaffRole } from '@/shared/types/identity'
import { primaryStaffRole } from '@/features/pos/utils/role'

export type DiscountType = 'amount' | 'percent'

export type DiscountPayload = {
  type: DiscountType
  value: number
  reason: string
} | null

/**
 * Discount capability config — role defaults + optional per-staff override (ADR-0012 path).
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

export const NONE_DISCOUNT_PERMISSIONS: DiscountPermissionConfig = {
  manual: false,
  typeAmount: false,
  typePercent: false,
  maxAmount: null,
  maxPercent: null,
  canEdit: false,
  canRemove: false,
}

export const FULL_DISCOUNT_PERMISSIONS: DiscountPermissionConfig = {
  manual: true,
  typeAmount: true,
  typePercent: true,
  maxAmount: null,
  maxPercent: null,
  canEdit: true,
  canRemove: true,
}

/** Role defaults when staff.discount_permissions is NULL. */
export const DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE: Record<
  StaffRole,
  DiscountPermissionConfig
> = {
  owner: FULL_DISCOUNT_PERMISSIONS,
  manager: FULL_DISCOUNT_PERMISSIONS,
  cashier: NONE_DISCOUNT_PERMISSIONS,
  remote_operator: NONE_DISCOUNT_PERMISSIONS,
  waiter: NONE_DISCOUNT_PERMISSIONS,
  kitchen: NONE_DISCOUNT_PERMISSIONS,
}

export function parseDiscountPermissions(
  raw: unknown,
  fallbackRole?: StaffRole | null,
): DiscountPermissionConfig {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    return {
      manual: Boolean(r.manual),
      typeAmount: Boolean(r.typeAmount),
      typePercent: Boolean(r.typePercent),
      maxAmount:
        r.maxAmount === null || r.maxAmount === undefined || r.maxAmount === ''
          ? null
          : Number(r.maxAmount),
      maxPercent:
        r.maxPercent === null || r.maxPercent === undefined || r.maxPercent === ''
          ? null
          : Number(r.maxPercent),
      canEdit: Boolean(r.canEdit),
      canRemove: Boolean(r.canRemove),
    }
  }
  return DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE[fallbackRole ?? 'cashier']
}

export function discountPermissionsToPayload(
  config: DiscountPermissionConfig,
): DiscountPermissionConfig {
  return {
    manual: Boolean(config.manual),
    typeAmount: Boolean(config.typeAmount),
    typePercent: Boolean(config.typePercent),
    maxAmount:
      config.maxAmount != null && Number.isFinite(config.maxAmount)
        ? Number(config.maxAmount)
        : null,
    maxPercent:
      config.maxPercent != null && Number.isFinite(config.maxPercent)
        ? Number(config.maxPercent)
        : null,
    canEdit: Boolean(config.canEdit),
    canRemove: Boolean(config.canRemove),
  }
}

export function resolveDiscountPermissions(
  canDiscount: boolean,
  roles: readonly StaffRole[],
  stored?: DiscountPermissionConfig | null,
): DiscountPermissionConfig {
  if (stored) return stored
  if (!canDiscount) return NONE_DISCOUNT_PERMISSIONS
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
