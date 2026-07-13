import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  approveCollection,
  approveExpense,
  approvePendingForShift,
  fetchPendingCollections,
  fetchPendingExpenses,
  parsePendingExpensesSummary,
  parsePendingSummary,
  rejectCollection,
  rejectExpense,
  rejectPendingForShift,
} from '@/features/orders/api/orders.api'
import type { PendingSummary } from '@/features/orders/types'
import { formatMoney } from '@/features/treasury/utils/format'
import type { ShiftReport } from '@/features/treasury/types'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  shift: ShiftReport | null
}

type View = 'summary' | 'exceptions'
type RejectTarget =
  | { kind: 'collection'; id: string }
  | { kind: 'expense'; id: string }
  | { kind: 'all' }

function categoryLabel(code: string): string {
  const map = t.treasury.expenseCategory as Record<string, string>
  return map[code] ?? code
}

export function CollectionApprovalDialog({ open, onOpenChange, shift }: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('summary')
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const summary = parsePendingSummary(shift as Record<string, unknown> | null)
  const expenseSummary = parsePendingExpensesSummary(
    shift as Record<string, unknown> | null,
  )
  const shiftId = shift?.id ?? ''

  const pendingQuery = useQuery({
    queryKey: ['orders', 'pending', shiftId],
    queryFn: () => fetchPendingCollections(shiftId),
    enabled: open && Boolean(shiftId),
  })

  const pendingExpensesQuery = useQuery({
    queryKey: ['orders', 'pending-expenses', shiftId],
    queryFn: () => fetchPendingExpenses(shiftId),
    enabled: open && Boolean(shiftId),
  })

  useEffect(() => {
    if (!open) {
      setView('summary')
      setRejectTarget(null)
      setRejectReason('')
    }
  }, [open])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: posKeys.context() })
    void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
    void queryClient.invalidateQueries({ queryKey: ['orders'] })
    void pendingQuery.refetch()
    void pendingExpensesQuery.refetch()
  }

  const approveAllMut = useMutation({
    mutationFn: () => approvePendingForShift(shiftId),
    onSuccess: (result) => {
      toast.success(
        t.orders.approval.approvedAll(
          result.approved_count,
          result.approved_expenses_count,
        ),
      )
      refresh()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectAllMut = useMutation({
    mutationFn: (reason: string) => rejectPendingForShift(shiftId, reason),
    onSuccess: (result) => {
      toast.success(
        t.orders.approval.rejectedAll(
          result.rejected_count,
          result.rejected_expenses_count,
        ),
      )
      setRejectTarget(null)
      setRejectReason('')
      refresh()
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const approveOneMut = useMutation({
    mutationFn: approveCollection,
    onSuccess: () => {
      toast.success(t.orders.approval.approveOne)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const approveExpenseMut = useMutation({
    mutationFn: approveExpense,
    onSuccess: () => {
      toast.success(t.orders.approval.approveOne)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: ({
      kind,
      id,
      reason,
    }: {
      kind: 'collection' | 'expense'
      id: string
      reason: string
    }) =>
      kind === 'collection'
        ? rejectCollection(id, reason)
        : rejectExpense(id, reason),
    onSuccess: () => {
      toast.success(t.orders.approval.rejectOne)
      setRejectTarget(null)
      setRejectReason('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const collectionRows = pendingQuery.data ?? []
  const expenseRows = pendingExpensesQuery.data ?? []
  const pendingCount = summary?.count ?? collectionRows.length
  const pendingAmount =
    summary?.amount ?? collectionRows.reduce((s, r) => s + Number(r.amount), 0)
  const byMethod = summary?.by_payment_method ?? []
  const pendingExpCount = expenseSummary?.count ?? expenseRows.length
  const pendingExpAmount =
    expenseSummary?.amount ??
    expenseRows.reduce((s, r) => s + Number(r.amount), 0)
  const byCategory = expenseSummary?.by_category ?? []
  const totalPending = pendingCount + pendingExpCount

  const summaryKpis = (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground">
          {t.orders.approval.operationalDrawer}
        </p>
        <p className="font-semibold" dir="ltr">
          {formatMoney(
            Number(shift?.operational_drawer_balance ?? shift?.expected_cash),
          )}
        </p>
      </div>
      <div className="bg-muted rounded-md p-2">
        <p className="text-muted-foreground">
          {t.orders.approval.approvedRevenue}
        </p>
        <p className="font-semibold" dir="ltr">
          {formatMoney(Number(shift?.approved_revenue ?? 0))}
        </p>
      </div>
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.orders.approval.title}</DialogTitle>
          </DialogHeader>

          {!shift ? (
            <p className="text-muted-foreground text-sm">
              {t.treasury.shift.noOpenShift}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold',
                    view === 'summary'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent bg-muted',
                  )}
                  onClick={() => setView('summary')}
                >
                  {t.orders.approval.shiftKpis}
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm font-semibold',
                    view === 'exceptions'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent bg-muted',
                  )}
                  onClick={() => setView('exceptions')}
                >
                  {t.orders.approval.reviewExceptions}
                  {totalPending > 0 ? ` (${totalPending})` : ''}
                </button>
              </div>

              {view === 'summary' ? (
                <>
                  {summaryKpis}

                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-semibold">
                      {t.orders.approval.collectionsSection}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">
                          {t.orders.approval.pendingCount}
                        </p>
                        <p className="font-semibold">{pendingCount}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          {t.orders.approval.pendingTotal}
                        </p>
                        <p className="font-semibold" dir="ltr">
                          {formatMoney(pendingAmount)}
                        </p>
                      </div>
                    </div>
                    {byMethod.length > 0 ? (
                      <div className="space-y-1 text-sm">
                        <p className="text-muted-foreground font-medium">
                          {t.orders.approval.byMethod}
                        </p>
                        {byMethod.map(
                          (m: PendingSummary['by_payment_method'][number]) => (
                            <div
                              key={m.payment_method_id}
                              className="flex justify-between"
                            >
                              <span>{m.name}</span>
                              <span>
                                {m.count} · {formatMoney(m.amount)}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-semibold">
                      {t.orders.approval.expensesSection}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">
                          {t.orders.approval.pendingExpenses}
                        </p>
                        <p className="font-semibold">{pendingExpCount}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          {t.orders.approval.pendingExpensesTotal}
                        </p>
                        <p className="font-semibold" dir="ltr">
                          {formatMoney(pendingExpAmount)}
                        </p>
                      </div>
                    </div>
                    {byCategory.length > 0 ? (
                      <div className="space-y-1 text-sm">
                        <p className="text-muted-foreground font-medium">
                          {t.orders.approval.byCategory}
                        </p>
                        {byCategory.map((c) => (
                          <div
                            key={c.category}
                            className="flex justify-between"
                          >
                            <span>{categoryLabel(c.category)}</span>
                            <span>
                              {c.count} · {formatMoney(c.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {totalPending > 0 ? (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        className="w-full"
                        disabled={approveAllMut.isPending || !shiftId}
                        onClick={() => approveAllMut.mutate()}
                      >
                        {t.orders.approval.approveAll}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setView('exceptions')}
                      >
                        {t.orders.approval.reviewExceptions}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        disabled={rejectAllMut.isPending || !shiftId}
                        onClick={() => setRejectTarget({ kind: 'all' })}
                      >
                        {t.orders.approval.rejectAll}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center text-sm">
                      {t.orders.approval.noPending}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {summaryKpis}
                  <div className="max-h-80 space-y-4 overflow-y-auto">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">
                        {t.orders.approval.collectionsSection}
                      </p>
                      {pendingQuery.isLoading ? (
                        <p className="text-muted-foreground text-sm">…</p>
                      ) : collectionRows.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t.orders.approval.noPendingCollections}
                        </p>
                      ) : (
                        collectionRows.map((row) => (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                          >
                            <div>
                              <p className="font-medium" dir="ltr">
                                {row.order_reference}
                              </p>
                              <p className="text-muted-foreground">
                                {row.payment_method} ·{' '}
                                {formatMoney(row.amount)}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                disabled={approveOneMut.isPending}
                                onClick={() => approveOneMut.mutate(row.id)}
                              >
                                {t.orders.approval.approveOne}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setRejectTarget({
                                    kind: 'collection',
                                    id: row.id,
                                  })
                                }
                              >
                                {t.orders.approval.rejectOne}
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold">
                        {t.orders.approval.expensesSection}
                      </p>
                      {pendingExpensesQuery.isLoading ? (
                        <p className="text-muted-foreground text-sm">…</p>
                      ) : expenseRows.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t.orders.approval.noPendingExpenses}
                        </p>
                      ) : (
                        expenseRows.map((row) => (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                          >
                            <div>
                              <p className="font-medium" dir="ltr">
                                {row.reference}
                              </p>
                              <p className="text-muted-foreground">
                                {categoryLabel(row.category)} ·{' '}
                                {formatMoney(row.amount)}
                              </p>
                              {row.description ? (
                                <p className="text-muted-foreground text-xs">
                                  {t.orders.approval.expenseReason}:{' '}
                                  {row.description}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                disabled={approveExpenseMut.isPending}
                                onClick={() =>
                                  approveExpenseMut.mutate(row.id)
                                }
                              >
                                {t.orders.approval.approveOne}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setRejectTarget({
                                    kind: 'expense',
                                    id: row.id,
                                  })
                                }
                              >
                                {t.orders.approval.rejectOne}
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => setView('summary')}
                  >
                    {t.orders.approval.backToSummary}
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRejectTarget(null)
            setRejectReason('')
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {rejectTarget?.kind === 'all'
                ? t.orders.approval.rejectAll
                : t.orders.approval.rejectOne}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t.orders.approval.rejectReason}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={rejectMut.isPending || rejectAllMut.isPending}
            onClick={() => {
              if (!rejectReason.trim()) {
                toast.error(t.orders.approval.rejectReasonRequired)
                return
              }
              if (!rejectTarget) return
              if (rejectTarget.kind === 'all') {
                rejectAllMut.mutate(rejectReason)
                return
              }
              rejectMut.mutate({
                kind: rejectTarget.kind,
                id: rejectTarget.id,
                reason: rejectReason,
              })
            }}
          >
            {rejectTarget?.kind === 'all'
              ? t.orders.approval.rejectAll
              : t.orders.approval.rejectOne}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
