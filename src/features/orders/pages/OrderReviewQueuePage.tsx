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
import { formatMoney } from '@/features/treasury/utils/format'
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
      <h1 className="text-xl font-semibold">{t.orders.review.title}</h1>

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
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold" dir="ltr">
            {row.reference}
          </p>
          <p className="text-muted-foreground text-sm">
            {t.orders.review.cashier}: {row.cashier_name ?? '—'}
          </p>
        </div>
        <Badge variant="secondary">{t.orders.review.title}</Badge>
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">{t.orders.review.reason}: </span>
        {row.review_reason ?? '—'}
      </p>
      {row.financial_delta != null ? (
        <p className="text-sm">
          <span className="text-muted-foreground">
            {t.orders.review.financialDelta}:{' '}
          </span>
          {formatMoney(row.financial_delta)}
        </p>
      ) : null}
      {row.last_edit_at ? (
        <p className="text-muted-foreground text-xs">
          {t.orders.review.lastEdit}:{' '}
          {new Date(row.last_edit_at).toLocaleString('ar-EG')}
        </p>
      ) : null}

      <OrderMoneySummary money={row.money} />

      {detailQuery.data?.timeline?.length ? (
        <div className="border-t pt-2">
          <p className="mb-2 text-sm font-medium">{t.orders.hub.timeline}</p>
          <ol className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {detailQuery.data.timeline.map((ev) => (
              <li key={ev.id} className="border-s-2 ps-2">
                <span className="font-medium">
                  {ev.label ??
                    (t.orders.timeline as Record<string, string>)[ev.event_type] ??
                    ev.event_type}
                </span>
                <span className="text-muted-foreground ms-2 text-xs">
                  {new Date(ev.created_at).toLocaleString('ar-EG')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <Button type="button" size="sm" disabled={clearing} onClick={onClear}>
        {t.orders.review.clear}
      </Button>
    </div>
  )
}
