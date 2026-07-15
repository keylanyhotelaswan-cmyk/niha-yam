import { formatMoney } from '@/features/treasury/utils/format'
import { t } from '@/shared/i18n'

export type DiscountType = 'amount' | 'percent'

export type DiscountMeta = {
  type?: DiscountType | null
  value?: number | null
  amount?: number | null
  reason?: string | null
}

/** Cashier-facing discount headline: "خصم 10%" or "خصم 50.00 ج.م" — never conflate types. */
export function formatDiscountHeadline(meta: DiscountMeta): string | null {
  const amount = Number(meta.amount ?? 0)
  if (!(amount > 0.001)) return null

  if (meta.type === 'percent' && meta.value != null && meta.value > 0) {
    return t.pos.discount.headlinePercent(meta.value)
  }

  if (meta.type === 'amount' && meta.value != null && meta.value > 0) {
    return t.pos.discount.headlineAmount(formatMoney(meta.value))
  }

  return t.pos.discount.headlineAmount(formatMoney(amount))
}

/** Secondary line for percent discounts: computed EGP value. */
export function formatDiscountValueLine(meta: DiscountMeta): string | null {
  const amount = Number(meta.amount ?? 0)
  if (meta.type !== 'percent' || !(amount > 0.001)) return null
  return t.pos.discount.valueLine(formatMoney(amount))
}

export function hasDiscount(meta: DiscountMeta): boolean {
  return Number(meta.amount ?? 0) > 0.001
}
