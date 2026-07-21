import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  clearOrderReview,
  fetchOrderDetail,
  fetchReviewQueue,
} from '@/features/orders/api/orders.api'
import { OrderMoneySummary } from '@/features/orders/components/OrderMoneySummary'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import { t } from '@/shared/i18n'

export function OrderReviewQueuePage() {
  const queryClient = useQueryClient()
  const queueQuery = useQuery({
    queryKey: ['orders', 'review-queue'],
    queryFn: fetchReviewQueue,
  })

  const clearMut = useMutation({
    mutationFn: clearOrderReview,
    onSuccess: () => {
      toast.success(t.orders.review.clear)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const items = queueQuery.data ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-[#991b1b]">{t.orders.review.title}</h1>

      {queueQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">{t.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.orders.review.empty}</p>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <ReviewCard
              key={row.id}
              row={row}
              onClear={() => clearMut.mutate(row.id)}
              clearing={clearMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({
  row,
  onClear,
  clearing,
}: {
  row: Awaited<ReturnType<typeof fetchReviewQueue>>[number]
  onClear: () => void
  clearing: boolean
}) {
  const detailQuery = useQuery({
    queryKey: ['orders', 'detail', row.id],
    queryFn: () => fetchOrderDetail(row.id),
  })

  return (
    <div className="space-y-3 rounded-2xl border-2 border-[#dc2626] bg-[#fef2f2] p-4 shadow-[0_8px_24px_rgba(220,38,38,0.12)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold text-[#7f1d1d]" dir="ltr">
            {row.reference}
          </p>
          <p className="text-sm text-[#991b1b]">
            {t.orders.review.cashier}: {row.cashier_name ?? '—'}
          </p>
        </div>
        <Badge className="border-[#fecaca] bg-[#dc2626] px-3 py-1.5 text-sm font-bold text-white">
          {t.orders.review.badge}
        </Badge>
      </div>

      <div className="rounded-xl border border-[#fecaca] bg-white/80 p-3 text-sm text-[#7f1d1d]">
        <p>
          <span className="font-semibold">{t.orders.review.reason}: </span>
          {row.review_reason ?? '—'}
        </p>
        <p className="mt-1">
          <span className="font-semibold">{t.orders.review.by}: </span>
          {row.flagged_by_name ?? row.cashier_name ?? '—'}
        </p>
        <p className="mt-1">
          <span className="font-semibold">{t.orders.review.at}: </span>
          {formatDateTime(row.flagged_at ?? row.last_edit_at ?? row.created_at)}
        </p>
      </div>

      {row.financial_delta != null ? (
        <p className="text-sm font-semibold text-[#991b1b]">
          {t.orders.review.financialDelta}: {formatMoney(row.financial_delta)}
        </p>
      ) : null}

      {detailQuery.data?.money ? (
        <OrderMoneySummary money={detailQuery.data.money} />
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="border-[#dc2626] text-[#991b1b]"
        disabled={clearing}
        onClick={onClear}
      >
        {t.orders.review.clear}
      </Button>
    </div>
  )
}
