import { formatMoney } from '@/features/treasury/utils/format'
import {
  formatDiscountHeadline,
  formatDiscountValueLine,
  hasDiscount,
  type DiscountMeta,
} from '@/features/pos/utils/formatDiscount'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  /** Gross before discount */
  subtotal: number
  discountAmount?: number | null
  discountType?: DiscountMeta['type']
  discountValue?: number | null
  /** Net due (after discount) — same as order.total */
  total: number
  collected?: number | null
  remaining?: number | null
  className?: string
  /** Emphasize remaining (collection screens) */
  highlightRemaining?: boolean
}

/** Cashier-facing breakdown: subtotal → discount → net → collected → remaining. */
export function MoneyTotalsBreakdown({
  subtotal,
  discountAmount = 0,
  discountType,
  discountValue,
  total,
  collected,
  remaining,
  className,
  highlightRemaining,
}: Props) {
  const meta: DiscountMeta = {
    type: discountType,
    value: discountValue,
    amount: discountAmount,
  }
  const showDiscount = hasDiscount(meta)
  const discountHeadline = formatDiscountHeadline(meta)
  const discountValueLine = formatDiscountValueLine(meta)

  return (
    <div className={cn('space-y-1.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm', className)}>
      {showDiscount ? (
        <>
          <Row label={t.orders.money.subtotal} value={subtotal} />
          {discountHeadline ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748b]">{discountHeadline}</span>
              {discountType === 'amount' ? (
                <span dir="ltr" className="text-[#64748b]">
                  {formatMoney(-Number(discountAmount ?? 0))}
                </span>
              ) : discountValueLine ? (
                <span dir="ltr" className="text-[#64748b] text-xs">
                  {discountValueLine}
                </span>
              ) : null}
            </div>
          ) : (
            <Row label={t.orders.money.discount} value={-Number(discountAmount ?? 0)} muted />
          )}
        </>
      ) : null}
      <Row
        label={showDiscount ? t.orders.money.netTotal : t.orders.money.total}
        value={total}
        strong
      />
      {collected != null ? (
        <Row label={t.orders.money.collected} value={collected} />
      ) : null}
      {remaining != null ? (
        <Row
          label={t.orders.money.remaining}
          value={remaining}
          strong={highlightRemaining}
          accent={highlightRemaining}
        />
      ) : null}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  muted,
  accent,
}: {
  label: string
  value: number
  strong?: boolean
  muted?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={cn(
          'text-[#64748b]',
          accent && 'font-semibold text-[#b45309]',
          strong && !accent && 'font-semibold text-[#0f172a]',
        )}
      >
        {label}
      </span>
      <span
        dir="ltr"
        className={cn(
          muted && 'text-[#64748b]',
          strong && 'font-bold text-[#0f172a]',
          accent && 'font-bold text-[#b45309]',
        )}
      >
        {formatMoney(value)}
      </span>
    </div>
  )
}
