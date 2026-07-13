import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { fetchOrdersForPos } from '@/features/orders/api/orders.api'
import { OrderDetailDialog } from '@/features/orders/components/OrderDetailDialog'
import {
  CreateOrderDialog,
  type CreateOrderResult,
} from '@/features/pos/components/CreateOrderDialog'
import { SellSessionDialog } from '@/features/pos/components/SellSessionDialog'
import { usePosContext } from '@/features/pos/hooks/usePosQueries'
import {
  createEmptyDraft,
  type PosDraft,
} from '@/features/pos/state/pos-draft'
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

/**
 * Minimal call-center workspace: unpaid orders only — no cash / shift / treasury.
 */
export function CallCenterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { staff } = useSession()
  const contextQuery = usePosContext()
  const ctx = contextQuery.data
  const shiftId =
    (ctx?.open_shift as { id?: string } | null | undefined)?.id ?? null
  const hasOpenShift = Boolean(shiftId)

  const [createOpen, setCreateOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [activeDraft, setActiveDraft] = useState<PosDraft | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const unpaidQuery = useQuery({
    queryKey: ['orders', 'call-center', shiftId],
    queryFn: () =>
      fetchOrdersForPos({
        shiftId: shiftId ?? undefined,
        paymentStatus: 'unpaid',
        hubOnly: true,
      }),
    enabled: Boolean(shiftId),
    refetchInterval: 20_000,
  })

  function openDraft(draft: PosDraft) {
    setActiveDraft(draft)
    setSellOpen(true)
  }

  function onCreate(result: CreateOrderResult) {
    const draft = createEmptyDraft({
      orderType: result.orderType,
      payMode: 'later',
      customerMode: result.customerMode,
      customerId: result.customerId,
      customerName: result.customerName,
      customerPhone: result.customerPhone,
      deliveryAddress: result.deliveryAddress,
      deliveryZone: result.deliveryZone,
      dineInTableRef: result.dineInTableRef,
      deliveryDriverId: result.deliveryDriverId,
      orderNote: result.orderNote,
    })
    openDraft(draft)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-3xl space-y-4 p-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[#0f172a]">
            {t.callCenter.title}
          </h1>
          <p className="text-muted-foreground text-sm">{t.callCenter.subtitle}</p>
          {staff?.display_name ? (
            <p className="text-xs text-[#64748b]">{staff.display_name}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate('/gateway')}
          >
            {t.callCenter.backToGateway}
          </Button>
          <Button
            type="button"
            disabled={!hasOpenShift}
            onClick={() => {
              if (!hasOpenShift) {
                toast.error(t.callCenter.noShift)
                return
              }
              setCreateOpen(true)
            }}
          >
            {t.callCenter.createOrder}
          </Button>
        </div>
      </header>

      {!hasOpenShift ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {t.callCenter.noShift}
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-bold">{t.callCenter.unpaidList}</h2>
        {unpaidQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">{t.common.loading}</p>
        ) : (unpaidQuery.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.callCenter.empty}</p>
        ) : (
          <ul className="space-y-2">
            {(unpaidQuery.data ?? []).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-3 py-3 text-start text-sm shadow-sm hover:bg-[#f8fafc]"
                  onClick={() => setDetailId(o.id)}
                >
                  <div>
                    <p className="font-semibold" dir="ltr">
                      {o.reference}
                    </p>
                    <p className="text-xs text-[#64748b]">
                      {o.customer_name ?? '—'} · {formatDateTime(o.created_at)}
                      {o.created_by_name ? ` · ${o.created_by_name}` : ''}
                    </p>
                  </div>
                  <span className="font-bold" dir="ltr">
                    {formatMoney(o.total)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        unpaidOnly
        onCreate={onCreate}
      />

      <SellSessionDialog
        open={sellOpen}
        draft={activeDraft}
        onOpenChange={(open) => {
          setSellOpen(open)
          if (!open) setActiveDraft(null)
        }}
        onHold={() => {
          toast.message(t.pos.hold.title)
          setActiveDraft(null)
          setSellOpen(false)
        }}
        onCompleted={() => {
          setActiveDraft(null)
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
          void unpaidQuery.refetch()
        }}
      />

      <OrderDetailDialog
        orderId={detailId}
        onClose={() => setDetailId(null)}
        onNavigateOrder={(id) => setDetailId(id)}
      />
    </div>
  )
}
