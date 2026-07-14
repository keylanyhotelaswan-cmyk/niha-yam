import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Banknote, Pencil, Printer } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  assignDeliveryDriver,
  collectRemaining,
  fetchOrderDetail,
  updateFulfillmentStatus,
} from '@/features/orders/api/orders.api'
import { CustomerProfileDrawer } from '@/features/customers/components/CustomerProfileDrawer'
import { DeliveryDriversDialog } from '@/features/drivers/components/DeliveryDriversDialog'
import { FinancialAdjustPanel } from '@/features/orders/components/FinancialAdjustPanel'
import { OrderEditDialog } from '@/features/orders/components/OrderEditDialog'
import { OrderMoneySummary } from '@/features/orders/components/OrderMoneySummary'
import { ReprintDocumentsDialog } from '@/features/orders/components/ReprintDocumentsDialog'
import {
  PaymentBreakdownBadges,
  methodLabel,
} from '@/features/orders/components/PaymentBreakdownBadges'
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import { noteDisplayLines } from '@/features/pos/utils/line-note'
import { sortPaymentMethods } from '@/features/pos/utils/paymentMethods'
import { MoneyTotalsBreakdown } from '@/features/orders/components/MoneyTotalsBreakdown'
import { usePosContext } from '@/features/pos/hooks/usePosQueries'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { useSession } from '@/shared/session/SessionProvider'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

import type { Database } from '@/types/database.generated'

type FulfillmentStatus = Database['public']['Enums']['order_fulfillment_status']

const FULFILLMENT_FLOW: FulfillmentStatus[] = [
  'new',
  'preparing',
  'ready',
  'delivered',
]

type Props = {
  orderId: string | null
  onClose: () => void
  onNavigateOrder?: (orderId: string) => void
}

export function OrderDetailDialog({ orderId, onClose, onNavigateOrder }: Props) {
  const queryClient = useQueryClient()
  const { isManager } = useSession()
  const ctx = usePosContext().data
  const paymentMethods = sortPaymentMethods(ctx?.payment_methods ?? [])
  const cashPm = paymentMethods.find((p) => p.code === 'cash') ?? paymentMethods[0]
  const [editOpen, setEditOpen] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)
  const [collectAmount, setCollectAmount] = useState('')
  const [collectMethodId, setCollectMethodId] = useState('')
  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState('')
  const [driversOpen, setDriversOpen] = useState(false)
  const [reprintOpen, setReprintOpen] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => fetchOrderDetail(orderId!),
    enabled: Boolean(orderId),
  })

  const detail = detailQuery.data
  const remaining = detail?.money?.remaining_amount ?? 0
  const canEdit = detail
    ? detail.order.can_free_edit !== false &&
      !detail.money?.has_approved_collection
    : false
  const canCollect = remaining > 0.001
  const hasApproved = Boolean(detail?.money?.has_approved_collection)
  const drivers = ctx?.delivery_drivers ?? []

  const fulfillmentMut = useMutation({
    mutationFn: (status: FulfillmentStatus) =>
      updateFulfillmentStatus(orderId!, status),
    onSuccess: () => {
      toast.success(t.orders.fulfillment.updated)
      void detailQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const driverMut = useMutation({
    mutationFn: () =>
      assignDeliveryDriver(orderId!, driverId || null),
    onSuccess: () => {
      toast.success(t.drivers.assign)
      void detailQuery.refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const collectMut = useMutation({
    mutationFn: async () => {
      const methodId = collectMethodId || cashPm?.id
      if (!orderId || !methodId) throw new Error(t.orders.errors.generic)
      const amount = Number(collectAmount) || remaining
      return collectRemaining(orderId, [
        { payment_method_id: methodId, amount },
      ])
    },
    onSuccess: () => {
      toast.success(t.orders.hub.collectRemaining)
      setCollectOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void detailQuery.refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <Dialog
        open={orderId !== null && !editOpen}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent className="!flex max-h-[92dvh] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
          <DialogHeader className="border-b border-[#eef2f7] px-5 py-4">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-bold">
              {t.orders.hub.detail}
              {detail ? (
                <span className="font-normal text-[#64748b]" dir="ltr">
                  {detail.order.reference}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4">
            {detailQuery.isLoading ? (
              <p className="text-sm text-[#64748b]">{t.common.loading}</p>
            ) : detail ? (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge
                    className={
                      detail.order.payment_status === 'paid'
                        ? 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
                        : 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
                    }
                  >
                    {t.orders.status.payment[detail.order.payment_status]}
                  </Badge>
                  <Badge variant="outline">
                    {t.orders.status.fulfillment[detail.order.fulfillment_status]}
                  </Badge>
                  {detail.order.requires_review ? (
                    <Badge className="border-[#fde68a] bg-[#fef3c7] text-[#b45309]">
                      {t.orders.review.title}
                    </Badge>
                  ) : null}
                  {canEdit ? (
                    <Badge className="border-[#86efac] bg-[#dcfce7] text-[#15803d]">
                      {t.orders.hub.editOrder}
                    </Badge>
                  ) : (
                    <Badge className="border-[#fecaca] bg-[#fef2f2] text-[#dc2626]">
                      {t.orders.hub.freeEditBlocked}
                    </Badge>
                  )}
                </div>

                <OrderMoneySummary
                  money={detail.money}
                  subtotal={detail.order.subtotal}
                  discountAmount={detail.order.discount_amount}
                />

                <div className="rounded-2xl border border-white bg-white p-4 text-xs shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                  <p className="mb-2 text-sm font-bold">
                    {t.orders.hub.identity.title}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <IdentityRow
                      label={t.orders.hub.identity.createdBy}
                      value={
                        detail.order.created_by_name ??
                        detail.order.cashier_name ??
                        t.orders.hub.identity.none
                      }
                    />
                    <IdentityRow
                      label={t.orders.hub.identity.createdAt}
                      value={formatDateTime(detail.order.created_at)}
                    />
                    <IdentityRow
                      label={t.orders.hub.identity.lastEditedBy}
                      value={
                        detail.order.last_edited_by_name ??
                        t.orders.hub.identity.none
                      }
                    />
                    <IdentityRow
                      label={t.orders.hub.identity.lastEditedAt}
                      value={formatDateTime(detail.order.last_edited_at)}
                    />
                    <IdentityRow
                      label={t.orders.hub.identity.collectedBy}
                      value={
                        detail.order.collected_by_name ??
                        t.orders.hub.identity.none
                      }
                    />
                    <IdentityRow
                      label={t.orders.hub.identity.collectedAt}
                      value={formatDateTime(detail.order.collected_at)}
                    />
                  </div>
                </div>

                {hasApproved && isManager && detail.money ? (
                  <FinancialAdjustPanel
                    orderId={detail.order.id}
                    money={detail.money}
                    collections={detail.collections}
                    paymentMethods={paymentMethods}
                    onUpdated={() => {
                      void detailQuery.refetch()
                      void queryClient.invalidateQueries({ queryKey: ['orders'] })
                    }}
                  />
                ) : null}

                {detail.order.order_type !== 'takeaway' &&
                detail.order.fulfillment_status !== 'delivered' &&
                detail.order.fulfillment_status !== 'cancelled' ? (
                  <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                    <p className="mb-2 font-bold">{t.orders.hub.fulfillment}</p>
                    <p className="mb-2 text-xs text-[#64748b]">
                      {t.orders.status.fulfillment[detail.order.fulfillment_status]}
                    </p>
                    {(() => {
                      const idx = FULFILLMENT_FLOW.indexOf(
                        detail.order.fulfillment_status as FulfillmentStatus,
                      )
                      const next = FULFILLMENT_FLOW[idx + 1]
                      if (!next) return null
                      return (
                        <button
                          type="button"
                          disabled={fulfillmentMut.isPending}
                          className="rounded-xl bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white"
                          onClick={() => fulfillmentMut.mutate(next)}
                        >
                          {t.orders.fulfillment.advance}:{' '}
                          {t.orders.status.fulfillment[next]}
                        </button>
                      )
                    })()}
                  </div>
                ) : null}

                {detail.order.order_type === 'delivery' &&
                detail.order.fulfillment_status !== 'delivered' ? (
                  <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                    <p className="mb-2 font-bold">{t.drivers.assign}</p>
                    {detail.order.delivery_driver_name ? (
                      <p className="mb-2 text-sm">
                        {detail.order.delivery_driver_name}
                      </p>
                    ) : null}
                    {drivers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[#fdba74] bg-[#fff7ed] p-4 text-center">
                        <p className="mb-3 text-sm font-semibold text-[#c2410c]">
                          {t.drivers.empty}
                        </p>
                        {isManager ? (
                          <button
                            type="button"
                            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#f97316] px-4 text-sm font-semibold text-white"
                            onClick={() => setDriversOpen(true)}
                          >
                            {t.drivers.addNew}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <select
                          className="h-12 flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 text-base"
                          value={driverId || detail.order.delivery_driver_id || ''}
                          onChange={(e) => setDriverId(e.target.value)}
                        >
                          <option value="">{t.drivers.none}</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.display_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="min-h-12 rounded-xl bg-[#3b82f6] px-4 text-sm font-semibold text-white disabled:opacity-40"
                          disabled={driverMut.isPending}
                          onClick={() => driverMut.mutate()}
                        >
                          {t.common.save}
                        </button>
                      </div>
                    )}
                    {isManager && drivers.length > 0 ? (
                      <button
                        type="button"
                        className="mt-2 text-sm font-semibold text-[#2563eb]"
                        onClick={() => setDriversOpen(true)}
                      >
                        {t.drivers.manage}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                  <p className="mb-2 font-bold">
                    {t.orders.paymentMethods.title}
                  </p>
                  <PaymentBreakdownBadges
                    rows={
                      detail.payment_breakdown ??
                      detail.collections
                        .filter((c) =>
                          ['pending', 'approved'].includes(c.collection_status),
                        )
                        .reduce(
                          (acc, c) => {
                            const code = c.payment_method_code ?? 'unknown'
                            const existing = acc.find((x) => x.code === code)
                            const net =
                              c.net_amount ?? c.amount - (c.change_given ?? 0)
                            if (existing) {
                              existing.amount += net
                            } else {
                              acc.push({
                                payment_method_id: c.payment_method_id,
                                code,
                                name:
                                  c.payment_method_name ??
                                  methodLabel(code),
                                amount: net,
                              })
                            }
                            return acc
                          },
                          [] as Array<{
                            payment_method_id: string
                            code: string
                            name: string
                            amount: number
                          }>,
                        )
                    }
                  />
                </div>

                {!canEdit ? (
                  <p className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#b91c1c]">
                    {t.orders.hub.useAmendPath}
                  </p>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                    <p className="mb-2 font-bold">{t.pos.cart.title}</p>
                    <ul className="space-y-2">
                      {detail.items.map((line) => (
                        <li
                          key={line.id}
                          className="flex justify-between gap-3 rounded-xl bg-[#f8fafc] px-3 py-2"
                        >
                          <div className="min-w-0 text-start">
                            <p className="font-medium">
                              {line.quantity}× {line.name}
                            </p>
                            {line.line_note
                              ? noteDisplayLines(line.line_note).map((row) => (
                                  <p
                                    key={row}
                                    className="mt-0.5 text-xs font-medium text-[#15803d]"
                                  >
                                    {row}
                                  </p>
                                ))
                              : null}
                          </div>
                          <span className="shrink-0 font-semibold" dir="ltr">
                            {formatMoney(line.line_total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {detail.order.order_note ? (
                      <div className="mt-3 rounded-xl border border-[#dcfce7] bg-[#f0fdf4] px-3 py-2">
                        <p className="text-[11px] font-semibold text-[#64748b]">
                          {t.pos.lineExtras.orderNote}
                        </p>
                        <p className="text-sm font-medium text-[#15803d]">
                          {detail.order.order_note}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {(detail.order.delivery_name ||
                      detail.order.delivery_phone ||
                      detail.order.customer_id) && (
                      <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                        <div className="mb-1 flex items-center justify-between">
                          <p className="font-bold">{t.pos.create.customer}</p>
                          {detail.order.customer_id ? (
                            <button
                              type="button"
                              className="text-xs font-semibold text-[#2563eb]"
                              onClick={() =>
                                setProfileCustomerId(detail.order.customer_id)
                              }
                            >
                              {t.customers.profile.title}
                            </button>
                          ) : null}
                        </div>
                        {detail.order.dine_in_table_ref ? (
                          <p className="text-xs text-[#64748b]">
                            {t.pos.create.tableRef}:{' '}
                            {detail.order.dine_in_table_ref}
                          </p>
                        ) : null}
                        {detail.order.delivery_name ? (
                          <p>{detail.order.delivery_name}</p>
                        ) : null}
                        {detail.order.delivery_phone ? (
                          <p className="text-[#64748b]" dir="ltr">
                            {detail.order.delivery_phone}
                          </p>
                        ) : null}
                        {detail.order.delivery_address ? (
                          <p className="mt-1 text-xs text-[#64748b]">
                            {detail.order.delivery_address}
                          </p>
                        ) : null}
                      </div>
                    )}

                    {detail.collections.length > 0 ? (
                      <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                        <p className="mb-2 font-bold">
                          {t.orders.paymentMethods.title}
                        </p>
                        {detail.collections
                          .filter((c) =>
                            ['pending', 'approved'].includes(c.collection_status),
                          )
                          .map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between gap-2 border-b border-[#f1f5f9] py-2 text-xs last:border-0"
                          >
                            <div>
                              <p className="font-semibold text-[#0f172a]">
                                {methodLabel(
                                  c.payment_method_code ?? '',
                                  c.payment_method_name,
                                )}
                              </p>
                              <p className="text-[#94a3b8]" dir="ltr">
                                {c.reference}
                              </p>
                            </div>
                            <div className="text-end">
                              <p className="font-bold" dir="ltr">
                                {formatMoney(c.amount)}
                              </p>
                              {isManager ? (
                                <p className="text-[#64748b]">
                                  {
                                    t.orders.status.collection[
                                      c.collection_status
                                    ]
                                  }
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
                      <p className="mb-2 font-bold">{t.orders.hub.timeline}</p>
                      <ol className="max-h-40 space-y-2 overflow-y-auto">
                        {detail.timeline
                          .filter((ev) => {
                            if (isManager) return true
                            // Cashier: hide internal approval lifecycle events
                            return ![
                              'collection.approved',
                              'collection.rejected',
                              'collection.reversed',
                            ].includes(ev.event_type)
                          })
                          .map((ev) => (
                          <li key={ev.id} className="border-s-2 border-[#3b82f6] ps-3">
                            <p className="font-medium">
                              {ev.label ??
                                (t.orders.timeline as Record<string, string>)[
                                  ev.event_type
                                ] ??
                                ev.event_type}
                            </p>
                            <p className="text-xs text-[#64748b]">
                              {new Date(ev.created_at).toLocaleString('ar-EG')}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {detail ? (
            <div className="grid gap-2 border-t border-[#eef2f7] bg-white p-4 sm:grid-cols-3">
              <button
                type="button"
                disabled={!canEdit}
                className={cn(
                  'inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white shadow-[0_6px_16px_rgba(59,130,246,0.28)] disabled:opacity-40',
                  'bg-[#3b82f6] hover:bg-[#2563eb]',
                )}
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-5" />
                {t.orders.hub.editOrder}
              </button>
              <button
                type="button"
                disabled={!canCollect}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#f97316] text-sm font-semibold text-white shadow-[0_6px_16px_rgba(249,115,22,0.28)] hover:bg-[#ea580c] disabled:opacity-40"
                onClick={() => {
                  setCollectAmount(String(remaining))
                  setCollectMethodId(cashPm?.id ?? '')
                  setCollectOpen(true)
                }}
              >
                <Banknote className="size-5" />
                {t.orders.hub.collectRemaining}
              </button>
              <button
                type="button"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-[#e2e8f0] bg-white text-sm font-semibold text-[#334155]"
                onClick={() => setReprintOpen(true)}
              >
                <Printer className="size-5" />
                {t.orders.hub.reprint}
              </button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <CustomerProfileDrawer
        customerId={profileCustomerId}
        onClose={() => setProfileCustomerId(null)}
        onSelectOrder={(id) => {
          setProfileCustomerId(null)
          onNavigateOrder?.(id)
        }}
      />

      <ReprintDocumentsDialog
        orderId={orderId}
        open={reprintOpen}
        onOpenChange={setReprintOpen}
        onDone={() => {
          void detailQuery.refetch()
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
        }}
      />

      <DeliveryDriversDialog
        open={driversOpen}
        onOpenChange={(open) => {
          setDriversOpen(open)
          if (!open) {
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
          }
        }}
      />

      {detail ? (
        <OrderEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          detail={detail}
          onSaved={() => {
            void detailQuery.refetch()
            void queryClient.invalidateQueries({ queryKey: ['orders'] })
          }}
        />
      ) : null}

      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t.orders.hub.collectRemaining}</DialogTitle>
          </DialogHeader>
          {detail ? (
            <MoneyTotalsBreakdown
              subtotal={detail.order.subtotal}
              discountAmount={detail.order.discount_amount}
              total={detail.money?.order_total ?? detail.order.total}
              collected={detail.money?.collected_amount ?? 0}
              remaining={remaining}
              highlightRemaining
            />
          ) : (
            <p className="text-sm text-[#64748b]">
              {t.orders.money.remaining}: {formatMoney(remaining)}
            </p>
          )}
          {paymentMethods.length === 0 ? (
            <p className="text-destructive text-sm">{t.pos.payment.noPaymentMethods}</p>
          ) : null}
          <select
            className="h-12 w-full rounded-2xl border border-[#e2e8f0] bg-white px-3 text-sm"
            value={collectMethodId}
            onChange={(e) => setCollectMethodId(e.target.value)}
          >
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Input
            className="h-12 rounded-2xl"
            type="number"
            value={collectAmount}
            onChange={(e) => setCollectAmount(e.target.value)}
            dir="ltr"
          />
          <Button
            type="button"
            className="min-h-12 rounded-2xl bg-[#22c55e] hover:bg-[#16a34a]"
            disabled={collectMut.isPending || paymentMethods.length === 0}
            onClick={() => collectMut.mutate()}
          >
            {t.orders.hub.collectRemaining}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#64748b]">{label}</span>
      <span className="font-semibold text-[#0f172a]">{value}</span>
    </div>
  )
}
