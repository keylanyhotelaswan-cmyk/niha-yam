import { formatMoney } from '@/features/treasury/utils/format'
import type { OrderMoney } from '@/features/orders/types'
import { t } from '@/shared/i18n'

type Props = {
  money: OrderMoney | null | undefined
  compact?: boolean
}

export function OrderMoneySummary({ money, compact }: Props) {
  if (!money) return null
  const statusLabel =
    t.orders.status.payment[
      money.payment_status as keyof typeof t.orders.status.payment
    ] ?? money.payment_status

  if (compact) {
    return (
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <span>
          {t.orders.money.total}: {formatMoney(money.order_total)}
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
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground text-xs">{t.orders.money.total}</p>
        <p className="font-semibold">{formatMoney(money.order_total)}</p>
      </div>
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground text-xs">{t.orders.money.collected}</p>
        <p className="font-semibold">{formatMoney(money.collected_amount)}</p>
      </div>
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground text-xs">{t.orders.money.remaining}</p>
        <p className="font-semibold">{formatMoney(money.remaining_amount)}</p>
      </div>
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground text-xs">{t.orders.money.status}</p>
        <p className="font-semibold">{statusLabel}</p>
      </div>
    </div>
  )
}
