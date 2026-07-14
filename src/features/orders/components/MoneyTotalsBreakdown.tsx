import { formatMoney } from '@/features/treasury/utils/format'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  /** Gross before discount */
  subtotal: number
  discountAmount?: number | null
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
  total,
  collected,
  remaining,
  className,
  highlightRemaining,
}: Props) {
  const disc = Number(discountAmount ?? 0)
  const showDiscount = disc > 0.001

  return (
    <div className={cn('space-y-1.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm', className)}>
      {showDiscount ? (
        <>
          <Row label={t.orders.money.subtotal} value={subtotal} />
          <Row label={t.orders.money.discount} value={-disc} muted />
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
