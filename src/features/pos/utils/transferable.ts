import type { PosOperationalTreasury } from '@/features/pos/types'

/**
 * Cashier-facing transferable amount = operational balance from get_pos_context.
 * Approval/ledger figures are admin-only and must not zero out POS transfer UX.
 */
export function transferableAmount(
  tr: Pick<PosOperationalTreasury, 'balance' | 'approved_balance'> | undefined,
): number {
  if (!tr) return 0
  return Math.max(0, Number(tr.balance ?? 0))
}

/** Reset transfer form fields only when the dialog opens (not on every render). */
export function shouldResetTransferForm(wasOpen: boolean, isOpen: boolean): boolean {
  return isOpen && !wasOpen
}
