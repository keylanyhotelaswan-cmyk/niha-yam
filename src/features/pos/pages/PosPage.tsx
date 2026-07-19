import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutList,
  Printer,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { OpenShiftDialog } from '@/features/treasury/components/dialogs/OpenShiftDialog'
import { CloseShiftDialog } from '@/features/treasury/components/dialogs/CloseShiftDialog'
import { OrderDetailDialog } from '@/features/orders/components/OrderDetailDialog'
import { ReprintDocumentsDialog } from '@/features/orders/components/ReprintDocumentsDialog'
import { PaymentMethodTotalsStrip } from '@/features/orders/components/PaymentBreakdownBadges'
import { fetchOrdersForPos } from '@/features/orders/api/orders.api'
import { CreateOrderDialog } from '@/features/pos/components/CreateOrderDialog'
import { PosSearchResults } from '@/features/pos/components/PosSearchResults'
import { PosSideNav } from '@/features/pos/components/PosSideNav'
import { SellSessionDialog } from '@/features/pos/components/SellSessionDialog'
import { usePosWorkspace } from '@/features/pos/components/PosWorkspace'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { usePosContext } from '@/features/pos/hooks/usePosQueries'
import { useCollectionTotals } from '@/features/pos/hooks/useTodayOrderTotals'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import {
  createEmptyDraft,
  draftHasWork,
  loadHeldDrafts,
  parkDraft,
  saveHeldDrafts,
  type PosDraft,
} from '@/features/pos/state/pos-draft'
import type { OrderListItem } from '@/features/orders/types'
import { formatMoney } from '@/features/treasury/utils/format'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import type { ShiftReport } from '@/features/treasury/types'

type HubFilter =
  | 'action'
  | 'all'
  | 'paid'
  | 'unpaid'
  | 'partial'
  | 'needsReview'
  | 'held'
  | 'dine_in'
  | 'takeaway'
  | 'delivery'
  | 'ready'
  | 'cancelled'

/** Primary — action queue first (SHB). */
const PRIMARY_FILTERS: HubFilter[] = ['action', 'unpaid', 'partial', 'needsReview']

/** Secondary filters — compact chips. */
const SECONDARY_FILTERS: HubFilter[] = [
  'held',
  'dine_in',
  'takeaway',
  'delivery',
  'ready',
  'paid',
  'all',
]

const FILTERS: HubFilter[] = [...PRIMARY_FILTERS, ...SECONDARY_FILTERS]

/** Manager-only archive tab — cancelled stay out of cashier active queues. */
const MANAGER_ONLY_FILTERS: HubFilter[] = ['cancelled']

/** Cards per page — compact grid fits ~10 without scrolling the hub. */
const PAGE_SIZE = 10

function orderAmounts(order: OrderListItem) {
  const total = order.order_total ?? order.total
  const collected = order.collected_amount ?? 0
  const remaining = order.remaining_amount ?? Math.max(total - collected, 0)
  return { total, collected, remaining }
}

function paymentBadge(p: OrderListItem['payment_status']) {
  if (p === 'paid') return 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
  if (p === 'partial') return 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
  return 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
}

function cardChrome(order: OrderListItem) {
  if (order.fulfillment_status === 'cancelled') {
    return {
      border: 'border-[#94a3b8]',
      header: 'bg-[#f1f5f9] text-[#475569]',
      label: t.orders.hub.filters.cancelled,
    }
  }
  if (order.requires_review) {
    return {
      border: 'border-[#f97316]',
      header: 'bg-[#fff7ed] text-[#c2410c]',
      label: t.pos.hub.cardStatus.review,
    }
  }
  if (order.payment_status === 'paid') {
    return {
      border: 'border-[#22c55e]',
      header: 'bg-[#dcfce7] text-[#15803d]',
      label: t.pos.hub.cardStatus.paid,
    }
  }
  if (order.payment_status === 'partial') {
    return {
      border: 'border-[#3b82f6]',
      header: 'bg-[#eff6ff] text-[#2563eb]',
      label: t.pos.hub.cardStatus.partial,
    }
  }
  return {
    border: 'border-[#eab308]',
    header: 'bg-[#fef9c3] text-[#a16207]',
    label: t.pos.hub.cardStatus.unpaid,
  }
}

function typeBadge(type: OrderListItem['order_type']) {
  if (type === 'dine_in') return 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
  if (type === 'delivery') return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
  return 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
}

function typeLabel(type: OrderListItem['order_type']) {
  if (type === 'dine_in') return t.pos.create.types.dine_in
  if (type === 'delivery') return t.pos.create.types.delivery
  return t.pos.create.types.takeaway
}

function matchesFilter(order: OrderListItem, filter: HubFilter): boolean {
  if (filter === 'cancelled') {
    return order.fulfillment_status === 'cancelled'
  }
  // Cancelled never belong in cashier active / operational filters.
  if (order.fulfillment_status === 'cancelled') return false

  switch (filter) {
    case 'action':
      return (
        order.payment_status === 'unpaid' ||
        order.payment_status === 'partial' ||
        Boolean(order.requires_review)
      )
    case 'all':
      return true
    case 'paid':
      return order.payment_status === 'paid'
    case 'unpaid':
      return order.payment_status === 'unpaid'
    case 'partial':
      return order.payment_status === 'partial'
    case 'needsReview':
      return Boolean(order.requires_review)
    case 'dine_in':
      return order.order_type === 'dine_in'
    case 'takeaway':
      return order.order_type === 'takeaway'
    case 'delivery':
      return order.order_type === 'delivery'
    case 'ready':
      return order.fulfillment_status === 'ready'
    default:
      return true
  }
}

export function PosPage() {
  const queryClient = useQueryClient()
  const { openOps, setFeedbackLink } = usePosWorkspace()
  const contextQuery = usePosContext()
  const ctx = contextQuery.data
  const [searchParams, setSearchParams] = useSearchParams()
  const { isManager } = useSession()

  const allowedFilters = useMemo(
    () =>
      isManager ? [...FILTERS, ...MANAGER_ONLY_FILTERS] : FILTERS,
    [isManager],
  )
  const secondaryFilters = useMemo(
    () =>
      isManager
        ? [...SECONDARY_FILTERS, ...MANAGER_ONLY_FILTERS]
        : SECONDARY_FILTERS,
    [isManager],
  )

  const filterParam = searchParams.get('filter') as HubFilter | null
  const activeFilter: HubFilter =
    filterParam && allowedFilters.includes(filterParam)
      ? filterParam
      : 'action'
  const viewingCancelled = activeFilter === 'cancelled'

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reprintId, setReprintId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [activeDraft, setActiveDraft] = useState<PosDraft | null>(null)
  const [held, setHeld] = useState<PosDraft[]>(() => loadHeldDrafts())
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false)
  const [closeShiftOpen, setCloseShiftOpen] = useState(false)
  const [nav, setNav] = useState<'orders' | 'held' | 'shift' | 'ops'>('orders')

  const { can } = usePermissions()
  const allowDayTotals = can('treasury.manage') || can('reports.view')
  const shiftId =
    (ctx?.open_shift as { id?: string } | null | undefined)?.id ?? null

  useEffect(() => {
    if (detailId) setFeedbackLink('order', detailId)
    else if (nav === 'shift') setFeedbackLink('shift', shiftId)
    else setFeedbackLink(null, null)
  }, [detailId, nav, setFeedbackLink, shiftId])

  // Non-managers cannot stay on the cancelled archive tab.
  useEffect(() => {
    if (!isManager && filterParam === 'cancelled') {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('filter', 'action')
          return next
        },
        { replace: true },
      )
    }
  }, [isManager, filterParam, setSearchParams])

  const ordersQuery = useQuery({
    queryKey: [
      'orders',
      'list',
      search,
      shiftId,
      viewingCancelled ? 'cancelled' : 'active',
    ],
    queryFn: () =>
      fetchOrdersForPos({
        search: search || undefined,
        shiftId: shiftId ?? undefined,
        // With an open shift: show ALL shift orders (any cashier). hubOnly hides
        // paid+completed tickets and looked like "orders disappeared" after user switch.
        // Cancelled archive always lists cancelled only (not hub-action queue).
        hubOnly: viewingCancelled ? false : !shiftId,
        fulfillmentStatus: viewingCancelled ? 'cancelled' : undefined,
      }),
    refetchInterval: 30_000,
    enabled: true,
  })

  const cancelledCountQuery = useQuery({
    queryKey: ['orders', 'cancelled-count', shiftId],
    queryFn: () =>
      fetchOrdersForPos({
        shiftId: shiftId ?? undefined,
        hubOnly: false,
        fulfillmentStatus: 'cancelled',
      }),
    refetchInterval: 30_000,
    enabled: isManager && !viewingCancelled,
  })
  const {
    collectionStatusTotals,
    paymentMethodTotals: collectionPaymentTotals,
    trustCashTotal,
    scope: collectionScope,
    setScope: setCollectionScope,
    canToggleDay,
  } = useCollectionTotals({
    shiftId,
    allowDayScope: allowDayTotals,
  })

  /** Hub strips: cash = current-shift drawer ops; digital = operational treasuries. */
  const paymentStripRows = useMemo(() => {
    const rows: Array<{
      payment_method_id?: string
      code: string
      name?: string
      amount: number
    }> = []

    const drawerTreasury = (ctx?.operational_treasuries ?? []).find(
      (tr) => tr.code === 'drawer',
    )
    // Prefer explicit shift-scoped field; treasury.balance is also shift-scoped from get_pos_context.
    const drawerBalance =
      ctx?.operational_drawer_balance != null
        ? Number(ctx.operational_drawer_balance)
        : drawerTreasury != null
          ? Number(drawerTreasury.balance ?? 0)
          : null

    if (drawerBalance != null) {
      // Always show cash while a shift is open so transfers/expenses visibly reduce the total.
      if (shiftId || Math.abs(drawerBalance) > 0.001) {
        rows.push({
          payment_method_id: drawerTreasury?.id,
          code: 'cash',
          name: t.orders.paymentMethods.cash,
          amount: drawerBalance,
        })
      }
    } else {
      for (const r of collectionPaymentTotals) {
        if (r.code === 'cash') rows.push(r)
      }
    }

    for (const tr of ctx?.operational_treasuries ?? []) {
      if (tr.code === 'drawer') continue
      const amount = Number(tr.balance ?? 0)
      if (Math.abs(amount) <= 0.001) continue
      rows.push({
        payment_method_id: tr.id,
        code: tr.code,
        name: tr.name,
        amount,
      })
    }
    // Any non-cash collection method not represented by an operational treasury card
    for (const r of collectionPaymentTotals) {
      if (r.code === 'cash') continue
      if (rows.some((x) => x.code === r.code)) continue
      if (Math.abs(Number(r.amount)) <= 0.001) continue
      rows.push(r)
    }
    return rows
  }, [
    collectionPaymentTotals,
    ctx?.operational_treasuries,
    ctx?.operational_drawer_balance,
    shiftId,
  ])

  const netCashAmount = useMemo(() => {
    // Current shift only — never fall back to cumulative vault balance first.
    if (ctx?.operational_drawer_balance != null) {
      return Number(ctx.operational_drawer_balance)
    }
    const drawerTreasury = (ctx?.operational_treasuries ?? []).find(
      (tr) => tr.code === 'drawer',
    )
    if (drawerTreasury != null) return Number(drawerTreasury.balance ?? 0)
    return (
      collectionPaymentTotals.find((r) => r.code === 'cash')?.amount ?? 0
    )
  }, [
    ctx?.operational_drawer_balance,
    ctx?.operational_treasuries,
    collectionPaymentTotals,
  ])

  const moneyStatusCards = useMemo(() => {
    const paid = Number(collectionStatusTotals?.paid ?? 0)
    const unpaid = Number(collectionStatusTotals?.unpaid ?? 0)
    const partial = Number(collectionStatusTotals?.partial ?? 0)
    return [
      {
        key: 'netCash' as const,
        label: t.pos.hub.money.netCash,
        amount: netCashAmount,
        tone: 'bg-[#dcfce7] text-[#15803d]',
        filter: null,
      },
      {
        key: 'collected' as const,
        label: t.pos.hub.money.collected,
        amount: paid,
        tone: 'bg-[#dcfce7] text-[#15803d]',
        filter: 'paid' as HubFilter,
      },
      {
        key: 'uncollected' as const,
        label: t.pos.hub.money.uncollected,
        amount: unpaid + partial,
        tone: 'bg-[#fffbeb] text-[#b45309]',
        filter: unpaid >= partial ? ('unpaid' as HubFilter) : ('partial' as HubFilter),
      },
    ]
  }, [collectionStatusTotals, netCashAmount])

  const digitalStripRows = useMemo(
    () => paymentStripRows.filter((r) => r.code !== 'cash'),
    [paymentStripRows],
  )

  useEffect(() => {
    saveHeldDrafts(held)
  }, [held])

  useEffect(() => {
    if (activeFilter === 'held') setNav('held')
    else setNav('orders')
  }, [activeFilter])

  useEffect(() => {
    setPage(1)
  }, [activeFilter, search])

  const orders = useMemo(() => {
    if (activeFilter === 'held') return []
    return (ordersQuery.data ?? []).filter((o) => matchesFilter(o, activeFilter))
  }, [ordersQuery.data, activeFilter])

  const counts = useMemo(() => {
    const list = ordersQuery.data ?? []
    const result = {} as Record<HubFilter, number>
    for (const f of FILTERS) {
      if (f === 'held') result[f] = held.length
      else result[f] = list.filter((o) => matchesFilter(o, f)).length
    }
    if (isManager) {
      result.cancelled = viewingCancelled
        ? list.filter((o) => matchesFilter(o, 'cancelled')).length
        : (cancelledCountQuery.data ?? []).length
    }
    return result
  }, [
    ordersQuery.data,
    held.length,
    isManager,
    viewingCancelled,
    cancelledCountQuery.data,
  ])

  const listForPage = activeFilter === 'held' ? held : orders
  const totalPages = Math.max(1, Math.ceil(listForPage.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const pageItems = listForPage.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  function setFilter(next: HubFilter) {
    setPage(1)
    // Keep filter=all in the URL — clearing params falls back to 'action' by default.
    setSearchParams({ filter: next })
  }

  /** If there's an unfinished active draft, park it before starting another. */
  function parkActiveIfNeeded() {
    if (sellOpen) return
    if (!activeDraft || !draftHasWork(activeDraft)) return
    setHeld((prev) =>
      parkDraft(prev, {
        ...activeDraft,
        heldAt: activeDraft.heldAt ?? new Date().toISOString(),
      }),
    )
    toast.message(t.pos.hold.heldOutside)
  }

  function openDraft(draft: PosDraft) {
    if (sellOpen) return
    parkActiveIfNeeded()
    setActiveDraft({ ...draft, heldAt: null })
    setSellOpen(true)
  }

  const shift = ctx?.open_shift as ShiftReport | null
  const hasOpenShift = Boolean(shift)

  if (contextQuery.isLoading) {
    return (
      <div className="grid h-dvh place-items-center bg-[#eef1f6]">
        <Skeleton className="h-24 w-64" />
      </div>
    )
  }

  if (contextQuery.error || !ctx) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            {contextQuery.error instanceof Error
              ? contextQuery.error.message
              : t.errors.loadFailed}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#eef1f6] text-[#1e293b]" dir="rtl">
      <PosSideNav
        ctx={ctx}
        active={nav}
        heldCount={held.length}
        onOrders={() => {
          setNav('orders')
          setFilter('action')
        }}
        onHeld={() => {
          setNav('held')
          setFilter('held')
        }}
        onCreate={() => {
          if (!hasOpenShift) {
            toast.error(t.pos.errors.NO_OPEN_SHIFT)
            if (ctx.can_open_shift) setShiftDialogOpen(true)
            return
          }
          setCreateOpen(true)
        }}
        onShift={() => {
          setNav('shift')
          setShiftOpen(true)
        }}
        onOps={() => {
          setNav('ops')
          openOps()
        }}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-1.5">
          <div>
            <h1 className="text-lg font-bold text-[#0f172a]">
              {activeFilter === 'held' ? t.pos.hold.title : t.orders.hub.title}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasOpenShift ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setCloseShiftOpen(true)}
              >
                {t.treasury.shift.close}
              </Button>
            ) : null}
            {!hasOpenShift && ctx.can_open_shift ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShiftDialogOpen(true)}
              >
                {t.pos.shift.openAction}
              </Button>
            ) : null}
            {activeDraft && !sellOpen ? (
              <button
                type="button"
                className="min-h-9 rounded-xl bg-[#3b82f6] px-3 text-xs font-semibold text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)]"
                onClick={() => setSellOpen(true)}
              >
                {t.pos.sell.resumeCurrent} · {activeDraft.localRef}
              </button>
            ) : null}
          </div>
        </header>

        {!hasOpenShift ? (
          <div className="px-4 pb-1.5">
            <Alert>
              <AlertDescription>{t.pos.shift.closed}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {activeFilter !== 'held' ? (
          <div className="shrink-0 space-y-1.5 px-4 pb-1.5">
            <div className="space-y-1.5 rounded-xl border border-white/80 bg-white px-2.5 py-2 shadow-[0_2px_10px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold text-[#94a3b8]">
                  {collectionScope === 'shift'
                    ? t.orders.paymentMethods.shiftTotals
                    : t.orders.paymentMethods.dayTotals}
                </span>
                {canToggleDay && shiftId ? (
                  <div className="flex items-center gap-0.5 rounded-md border border-[#e2e8f0] p-0.5">
                    <button
                      type="button"
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        collectionScope === 'shift'
                          ? 'bg-[#eff6ff] text-[#2563eb]'
                          : 'text-[#94a3b8]',
                      )}
                      onClick={() => setCollectionScope('shift')}
                    >
                      {t.orders.paymentMethods.scopeShift}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        collectionScope === 'day'
                          ? 'bg-[#eff6ff] text-[#2563eb]'
                          : 'text-[#94a3b8]',
                      )}
                      onClick={() => setCollectionScope('day')}
                    >
                      {t.orders.paymentMethods.scopeDay}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {moneyStatusCards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    disabled={!card.filter}
                    onClick={() => {
                      if (card.filter) setFilter(card.filter)
                    }}
                    className={cn(
                      'rounded-xl px-2 py-2 text-center transition-shadow',
                      card.tone,
                      card.filter &&
                        activeFilter === card.filter &&
                        'ring-2 ring-[#93c5fd]',
                      card.filter
                        ? 'cursor-pointer hover:shadow-sm'
                        : 'cursor-default',
                    )}
                  >
                    <p className="text-[10px] font-semibold opacity-80">
                      {card.label}
                    </p>
                    <p className="mt-0.5 text-sm font-bold sm:text-base" dir="ltr">
                      {formatMoney(card.amount)}
                    </p>
                  </button>
                ))}
              </div>
              {digitalStripRows.length > 0 ? (
                <PaymentMethodTotalsStrip rows={digitalStripRows} compact />
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="shrink-0 px-4 pb-1.5">
          <div className="rounded-xl border border-white/80 bg-white px-2.5 py-1.5 shadow-[0_2px_10px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center gap-1.5">
              {PRIMARY_FILTERS.map((f) => {
                const active = activeFilter === f
                const label =
                  f === 'action'
                    ? t.orders.hub.filters.action
                    : f === 'unpaid'
                      ? t.orders.hub.filters.unpaid
                      : f === 'partial'
                        ? t.orders.hub.filters.partial
                        : t.orders.hub.filters.needsReview
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all',
                      active
                        ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
                        : 'border-[#eef2f7] bg-[#f8fafc] text-[#475569] hover:bg-white',
                    )}
                  >
                    {label}
                    <span className="text-[11px] font-bold">{counts[f]}</span>
                  </button>
                )
              })}
              <span className="mx-0.5 h-4 w-px bg-[#e2e8f0]" aria-hidden />
              {secondaryFilters.map((f) => {
                const active = activeFilter === f
                const label =
                  f === 'held'
                    ? t.pos.hold.title
                    : f === 'dine_in'
                      ? t.pos.create.types.dine_in
                      : f === 'needsReview'
                        ? t.orders.hub.filters.needsReview
                        : f === 'cancelled'
                          ? t.orders.hub.filters.cancelled
                          : t.orders.hub.filters[
                              f as keyof typeof t.orders.hub.filters
                            ]
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all',
                      active
                        ? f === 'cancelled'
                          ? 'border-[#cbd5e1] bg-[#f1f5f9] text-[#475569]'
                          : 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                        : 'border-transparent bg-transparent text-[#94a3b8] hover:bg-[#f8fafc]',
                    )}
                  >
                    {label}
                    <span>{counts[f] ?? 0}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {activeFilter !== 'held' ? (
          <div className="shrink-0 space-y-1.5 px-4 pb-1.5">
            <Input
              className="h-9 rounded-xl border-[#e2e8f0] bg-white text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.pos.search.hubPlaceholder}
            />
            <PosSearchResults
              query={search}
              onSelectOrder={(id) => {
                setSearch('')
                setDetailId(id)
              }}
              onSelectCustomer={(c) => {
                setSearch('')
                if (!hasOpenShift) {
                  toast.error(t.pos.errors.NO_OPEN_SHIFT)
                  return
                }
                const draft = createEmptyDraft({
                  orderType: 'delivery',
                  payMode: 'later',
                  customerMode: 'pick',
                  customerId: c.id,
                  customerName: c.display_name,
                  customerPhone: c.primary_phone ?? '',
                  deliveryAddress: '',
                  deliveryZone: '',
                  dineInTableRef: '',
                  deliveryDriverId: null,
                  orderNote: '',
                })
                openDraft(draft)
              }}
              onSelectProduct={(item) => {
                setSearch('')
                if (!hasOpenShift) {
                  toast.error(t.pos.errors.NO_OPEN_SHIFT)
                  return
                }
                const draft = createEmptyDraft({
                  orderType: 'takeaway',
                  payMode: 'later',
                  customerMode: 'walkin',
                  customerId: null,
                  customerName: '',
                  customerPhone: '',
                  deliveryAddress: '',
                  deliveryZone: '',
                  dineInTableRef: '',
                  deliveryDriverId: null,
                  orderNote: item.name,
                })
                openDraft(draft)
              }}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-2">
          <div className="min-h-0 flex-1 overflow-hidden">
            {activeFilter === 'held' ? (
              held.length === 0 ? (
                <EmptyState text={t.pos.hold.empty} />
              ) : (
                <div className="grid h-full content-start gap-1.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                  {(pageItems as PosDraft[]).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="rounded-xl border border-[#e8ecf2] bg-white p-2 text-right shadow-[0_1px_8px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)]"
                      onClick={() => {
                        setHeld((prev) => prev.filter((x) => x.id !== h.id))
                        setActiveDraft({ ...h, heldAt: null })
                        setSellOpen(true)
                        toast.message(t.pos.hold.resumed)
                      }}
                    >
                      <p className="text-sm font-bold" dir="ltr">
                        {h.localRef}
                      </p>
                      <p className="truncate text-xs">
                        {h.customerName || t.pos.create.walkin}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#64748b]">
                        {h.lines.reduce((s, l) => s + l.quantity, 0)}{' '}
                        {t.pos.hub.items} ·{' '}
                        {formatMoney(
                          h.lines.reduce(
                            (s, l) => s + l.unitPrice * l.quantity,
                            0,
                          ),
                        )}
                      </p>
                      <span className="mt-1.5 inline-flex min-h-8 w-full items-center justify-center rounded-lg bg-[#22c55e] text-xs font-semibold text-white">
                        {t.pos.hold.resume}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : ordersQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : orders.length === 0 ? (
              <EmptyState text={t.orders.hub.empty} />
            ) : (
              <div className="grid h-full content-start gap-1.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                {(pageItems as OrderListItem[]).map((o) => {
                  const { total, remaining } = orderAmounts(o)
                  const chrome = cardChrome(o)
                  return (
                    <div
                      key={o.id}
                      className={cn(
                        'overflow-hidden rounded-xl border bg-white shadow-[0_1px_8px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)]',
                        chrome.border,
                      )}
                    >
                      <div
                        className={cn(
                          'flex items-center justify-between px-1.5 py-0.5 text-[10px] font-bold',
                          chrome.header,
                        )}
                      >
                        <span className="truncate">{chrome.label}</span>
                        <span className="shrink-0 font-medium opacity-80">
                          {new Date(o.created_at).toLocaleTimeString('ar-EG', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="p-1.5 text-right">
                      <button
                        type="button"
                        className="w-full text-right"
                        onClick={() => setDetailId(o.id)}
                      >
                        <div className="mb-0.5 flex items-baseline justify-between gap-1">
                          <p
                            className="text-[13px] font-bold leading-tight text-[#0f172a]"
                            dir="ltr"
                          >
                            {o.reference}
                          </p>
                          <p className="truncate text-[11px] text-[#334155]">
                            {o.customer_name || t.pos.create.walkin}
                          </p>
                        </div>

                        <div className="mb-0.5 flex flex-wrap gap-0.5">
                          <span
                            className={cn(
                              'rounded border px-1 py-px text-[9px] font-semibold',
                              paymentBadge(o.payment_status),
                            )}
                          >
                            {t.orders.status.payment[o.payment_status]}
                          </span>
                          <span
                            className={cn(
                              'rounded border px-1 py-px text-[9px] font-semibold',
                              typeBadge(o.order_type),
                            )}
                          >
                            {typeLabel(o.order_type)}
                          </span>
                          {o.fulfillment_status === 'ready' ? (
                            <span className="rounded border border-[#86efac] bg-[#dcfce7] px-1 py-px text-[9px] font-semibold text-[#15803d]">
                              {t.orders.hub.filters.ready}
                            </span>
                          ) : null}
                        </div>

                        <div className="mb-0.5 flex items-center justify-between gap-1 text-[10px] text-[#64748b]">
                          <span>
                            {t.orders.money.total}{' '}
                            <strong className="text-[#0f172a]" dir="ltr">
                              {formatMoney(total)}
                            </strong>
                          </span>
                          <span
                            className={cn(
                              'rounded px-1 py-0.5 font-semibold',
                              remaining > 0.001
                                ? 'bg-[#dcfce7] text-[#15803d]'
                                : 'bg-[#f8fafc]',
                            )}
                          >
                            {t.orders.money.remaining}{' '}
                            <strong dir="ltr">{formatMoney(remaining)}</strong>
                          </span>
                        </div>
                      </button>

                      <div className="flex gap-0.5 border-t border-[#eef2f7] pt-1">
                        <button
                          type="button"
                          className="inline-flex min-h-7 flex-1 items-center justify-center gap-0.5 rounded-md bg-[#eff6ff] text-[10px] font-semibold text-[#2563eb]"
                          onClick={() => setDetailId(o.id)}
                        >
                          <FileText className="size-3" />
                          {t.orders.hub.summary}
                        </button>
                        {remaining > 0.001 ? (
                          <button
                            type="button"
                            className="inline-flex min-h-7 flex-1 flex-col items-center justify-center rounded-md bg-[#22c55e] px-0.5 text-white"
                            onClick={() => setDetailId(o.id)}
                          >
                            <span className="text-[9px] font-bold leading-none">
                              {t.pos.hub.collectNow}
                            </span>
                            <span className="text-[9px] font-semibold leading-none" dir="ltr">
                              {formatMoney(remaining)}
                            </span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex min-h-7 flex-1 items-center justify-center gap-0.5 rounded-md bg-[#f8fafc] text-[10px] font-semibold text-[#475569]"
                          onClick={() => setReprintId(o.id)}
                        >
                          <Printer className="size-3" />
                          {t.pos.hub.printShort}
                        </button>
                      </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {listForPage.length > 0 ? (
            <div className="mt-2 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-white/80 bg-white px-2 py-1.5 shadow-[0_2px_10px_rgba(15,23,42,0.05)]">
              <button
                type="button"
                disabled={safePage <= 1}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#2563eb] disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronRight className="size-4" />
                {t.common.previous}
              </button>
              <p className="text-xs font-semibold text-[#64748b]">
                {t.common.pageOf(safePage, totalPages)}
              </p>
              <button
                type="button"
                disabled={safePage >= totalPages}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#2563eb] disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t.common.next}
                <ChevronLeft className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      </main>

      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(result) => {
          const draft = createEmptyDraft({
            orderType: result.orderType,
            payMode: result.payMode,
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
        }}
      />

      <SellSessionDialog
        open={sellOpen}
        draft={activeDraft}
        onOpenChange={(open) => {
          setSellOpen(open)
        }}
        onHold={(draft) => {
          setHeld((prev) => parkDraft(prev, draft))
          setActiveDraft(null)
          setFilter('held')
        }}
        onCompleted={() => {
          setActiveDraft(null)
          setFilter('all')
        }}
      />

      <OrderDetailDialog
        orderId={detailId}
        onClose={() => setDetailId(null)}
        onNavigateOrder={(id) => setDetailId(id)}
      />

      <ReprintDocumentsDialog
        orderId={reprintId}
        open={Boolean(reprintId)}
        onOpenChange={(open) => {
          if (!open) setReprintId(null)
        }}
      />

      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>{t.pos.ops.shiftSummary}</DialogTitle>
          </DialogHeader>
          {canToggleDay && shift ? (
            <div className="mb-2 flex gap-1">
              <button
                type="button"
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold',
                  collectionScope === 'shift'
                    ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                    : 'border-[#e2e8f0] text-[#64748b]',
                )}
                onClick={() => setCollectionScope('shift')}
              >
                {t.orders.paymentMethods.scopeShift}
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold',
                  collectionScope === 'day'
                    ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                    : 'border-[#e2e8f0] text-[#64748b]',
                )}
                onClick={() => setCollectionScope('day')}
              >
                {t.orders.paymentMethods.scopeDay}
              </button>
            </div>
          ) : null}
          {shift ? (
            <>
              <ShiftSummary
                report={shift}
                collectionStatusTotals={collectionStatusTotals}
                paymentMethodTotals={collectionPaymentTotals}
                trustCashTotal={trustCashTotal}
              />
            </>
          ) : (
            <p className="text-sm text-[#64748b]">{t.pos.shift.closed}</p>
          )}
        </DialogContent>
      </Dialog>

      <OpenShiftDialog
        open={shiftDialogOpen}
        onOpenChange={(open) => {
          setShiftDialogOpen(open)
          if (!open) {
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
          }
        }}
        pendingNext={
          (ctx.pending_next_shift_handover as
            | import('@/features/treasury/api/treasury.api').PendingHandover
            | null
            | undefined) ?? null
        }
      />
      <CloseShiftDialog
        open={closeShiftOpen}
        shift={shift}
        onOpenChange={(open) => {
          setCloseShiftOpen(open)
          if (!open) {
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
          }
        }}
      />
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full mx-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-white/80 bg-white py-16 text-center shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      <LayoutList className="size-14 text-[#cbd5e1]" />
      <p className="text-sm text-[#64748b]">{text}</p>
    </div>
  )
}
