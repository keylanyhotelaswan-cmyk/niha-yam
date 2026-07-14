/** Shared cashier money display math — post-discount totals. */

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeDiscountAmount(
  subtotal: number,
  enabled: boolean,
  type: 'amount' | 'percent',
  value: number,
): number {
  if (!enabled || !(value > 0)) return 0
  if (type === 'percent') {
    return roundMoney(Math.min(subtotal, (subtotal * value) / 100))
  }
  return roundMoney(Math.min(subtotal, value))
}

export function netAfterDiscount(subtotal: number, discountAmount: number): number {
  return roundMoney(Math.max(0, subtotal - Math.max(0, discountAmount)))
}

export function remainingAfterPartial(
  netTotal: number,
  collected: number,
): number {
  return roundMoney(Math.max(0, netTotal - Math.max(0, collected)))
}

export const TRANSFER_REASON_PRESETS = [
  'delivery_payment',
  'collection_transfer',
  'payment_method_fix',
  'shift_settlement',
  'deposit',
  'withdrawal',
  'other',
] as const

export type TransferReasonPreset = (typeof TRANSFER_REASON_PRESETS)[number]

export function resolveTransferReason(
  preset: TransferReasonPreset | '',
  otherText: string,
  labels: Record<TransferReasonPreset, string>,
): string | null {
  if (!preset) return null
  if (preset === 'other') {
    const t = otherText.trim()
    return t.length > 0 ? t : null
  }
  return labels[preset] ?? preset
}
