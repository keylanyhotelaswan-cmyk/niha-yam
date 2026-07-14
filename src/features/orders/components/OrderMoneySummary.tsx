import { MoneyTotalsBreakdown } from '@/features/orders/components/MoneyTotalsBreakdown'
import { formatMoney } from '@/features/treasury/utils/format'
import type { OrderMoney } from '@/features/orders/types'
import { t } from '@/shared/i18n'

type Props = {
  money: OrderMoney | null | undefined
  subtotal?: number | null
  discountAmount?: number | null
  compact?: boolean
}

export function OrderMoneySummary({
  money,
  subtotal,
  discountAmount,
  compact,
}: Props) {
  if (!money) return null
  const statusLabel =
    t.orders.status.payment[
      money.payment_status as keyof typeof t.orders.status.payment
    ] ?? money.payment_status

  const sub = subtotal != null ? Number(subtotal) : null
  const disc = Number(discountAmount ?? 0)

  if (compact) {
    return (
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {disc > 0.001 ? (
          <span>
            {t.orders.money.discount}: {formatMoney(disc)}
          </span>
        ) : null}
        <span>
          {t.orders.money.netTotal}: {formatMoney(money.order_total)}
        </span>
        <span>
          {t.orders.money.collected}: {formatMoney(money.collected_amount)}
        </span>
        <span>
          {t.orders.money.remaining}: {formatMoney(money.remaining_amount)}
        </span>
        <span>{statusLabel}</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <MoneyTotalsBreakdown
        subtotal={sub ?? money.order_total}
        discountAmount={disc}
        total={money.order_total}
        collected={money.collected_amount}
        remaining={money.remaining_amount}
        highlightRemaining={money.remaining_amount > 0.001}
      />
      <p className="text-muted-foreground text-xs">
        {t.orders.money.status}: {statusLabel}
      </p>
    </div>
  )
}
