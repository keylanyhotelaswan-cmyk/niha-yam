import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  rejectCollection,
  rejectExpense,
} from '@/features/orders/api/orders.api'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import { useLedger } from '@/features/treasury/hooks/useTreasuryQueries'
import {
  useRejectAdjustment,
  useRejectTransfer,
} from '@/features/treasury/hooks/useTreasuryMutations'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { OpenShift, TreasuryBalance } from '@/features/treasury/types'
import { supabase } from '@/lib/supabase/client'
import { usePermissions } from '@/shared/access/permissions'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawerTreasuryId: string
  drawerName: string
  openShift: OpenShift | null
  balances: TreasuryBalance[]
}

type ExpenseRow = {
  id: string
  amount: number
  description: string | null
  status: string
  created_at: string
}

type CollectionRow = {
  id: string
  amount: number
  net: number
  method: string
  reference: string
  status: string
  order_ref: string
  created_at: string
}

type TransferRow = {
  id: string
  amount: number
  reason: string | null
  status: string
  route: string
  created_at: string
}

type AdjustmentRow = {
  id: string
  amount: number
  kind: string
  status: string
  reason: string | null
  created_at: string
}

type RejectTarget =
  | { kind: 'expense'; id: string }
  | { kind: 'collection'; id: string }
  | { kind: 'transfer'; id: string }
  | { kind: 'adjustment'; id: string }

export function DrawerMovementsDialog({
  open,
  onOpenChange,
  drawerTreasuryId,
  drawerName,
  openShift,
  balances,
}: Props) {
  const shiftId = openShift?.id ?? null
  const { can } = usePermissions()
  const canReject = can('treasury.manage')
  const queryClient = useQueryClient()
  const rejectTransfer = useRejectTransfer()
  const rejectAdjustment = useRejectAdjustment()
  const [target, setTarget] = useState<RejectTarget | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const ledgerQuery = useLedger(open ? drawerTreasuryId : null)

  const channels = balances.filter(
    (b) => !b.is_shift_drawer && b.is_active && b.type !== 'cash',
  )
  const drawerBal = Number(
    openShift?.operational_drawer_balance ??
      balances.find((b) => b.id === drawerTreasuryId)?.balance ??
      0,
  )

  const expensesQuery = useQuery({
    queryKey: [...treasuryKeys.all, 'drawer-movements-expenses', shiftId],
    enabled: open && Boolean(shiftId),
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, amount, description, status, created_at')
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
    },
  })

  const collectionsQuery = useQuery({
    queryKey: [...treasuryKeys.all, 'drawer-movements-collections', shiftId],
    enabled: open && Boolean(shiftId),
    queryFn: async (): Promise<CollectionRow[]> => {
      const { data, error } = await supabase
        .from('order_payments')
        .select(
          'id, amount, change_given, net_amount, reference, collection_status, created_at, payment_method_id, order_id',
        )
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      const rows = data ?? []
      const pmIds = [...new Set(rows.map((r) => r.payment_method_id).filter(Boolean))]
      const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))]
      const [{ data: pms }, { data: ords }] = await Promise.all([
        pmIds.length
          ? supabase.from('payment_methods').select('id, name, code').in('id', pmIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string; code: string }> }),
        orderIds.length
          ? supabase.from('orders').select('id, reference').in('id', orderIds)
          : Promise.resolve({ data: [] as Array<{ id: string; reference: string }> }),
      ])
      const pmMap = new Map((pms ?? []).map((p) => [p.id, p]))
      const ordMap = new Map((ords ?? []).map((o) => [o.id, o.reference]))
      return rows.map((r) => {
        const pm = pmMap.get(r.payment_method_id)
        const amount = Number(r.amount)
        const net = Number(r.net_amount ?? amount - Number(r.change_given ?? 0))
        return {
          id: r.id,
          amount,
          net,
          method: pm?.name ?? '—',
          reference: r.reference,
          status: r.collection_status,
          order_ref: ordMap.get(r.order_id) ?? '—',
          created_at: r.created_at,
        }
      })
    },
  })

  const transfersQuery = useQuery({
    queryKey: [...treasuryKeys.all, 'drawer-movements-transfers', shiftId],
    enabled: open && Boolean(shiftId),
    queryFn: async (): Promise<TransferRow[]> => {
      const { data, error } = await supabase
        .from('treasury_transfers')
        .select(
          'id, amount, reason, status, created_at, source_treasury_id, dest_treasury_id',
        )
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      const rows = data ?? []
      const ids = [
        ...new Set(
          rows.flatMap((r) => [r.source_treasury_id, r.dest_treasury_id]),
        ),
      ]
      const { data: tres } = ids.length
        ? await supabase.from('treasuries').select('id, name').in('id', ids)
        : { data: [] as Array<{ id: string; name: string }> }
      const map = new Map((tres ?? []).map((x) => [x.id, x.name]))
      return rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        reason: r.reason,
        status: r.status,
        route: `${map.get(r.source_treasury_id) ?? '—'} → ${map.get(r.dest_treasury_id) ?? '—'}`,
        created_at: r.created_at,
      }))
    },
  })

  const adjustmentsQuery = useQuery({
    queryKey: [...treasuryKeys.all, 'drawer-movements-adjustments', shiftId],
    enabled: open && Boolean(shiftId),
    queryFn: async (): Promise<AdjustmentRow[]> => {
      const { data, error } = await supabase
        .from('treasury_adjustments')
        .select('id, amount, kind, status, reason, created_at')
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        amount: Number(r.amount),
      }))
    },
  })

  function refresh() {
    void expensesQuery.refetch()
    void collectionsQuery.refetch()
    void transfersQuery.refetch()
    void adjustmentsQuery.refetch()
    void ledgerQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
  }

  const rejectMut = useMutation({
    mutationFn: async (reason: string) => {
      if (!target) throw new Error('NO_TARGET')
      if (target.kind === 'expense') await rejectExpense(target.id, reason)
      else if (target.kind === 'collection')
        await rejectCollection(target.id, reason)
      else if (target.kind === 'transfer')
        await new Promise<void>((resolve, reject) => {
          rejectTransfer.mutate(
            { id: target.id, reason },
            { onSuccess: () => resolve(), onError: (e) => reject(e) },
          )
        })
      else
        await new Promise<void>((resolve, reject) => {
          rejectAdjustment.mutate(
            { id: target.id, reason },
            { onSuccess: () => resolve(), onError: (e) => reject(e) },
          )
        })
    },
    onSuccess: () => {
      toast.success(t.treasury.lifecycle.rejected)
      setTarget(null)
      setReasonError(null)
      refresh()
    },
    onError: (e: Error) => setReasonError(e.message),
  })

  function RejectBtn(props: { enabled: boolean; onClick: () => void }) {
    if (!canReject || !props.enabled) return null
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2 text-[11px] text-destructive border-destructive/40"
        onClick={props.onClick}
      >
        {t.treasury.lifecycle.reject}
      </Button>
    )
  }

  const expenses = expensesQuery.data ?? []
  const collections = collectionsQuery.data ?? []
  const transfers = transfersQuery.data ?? []
  const adjustments = adjustmentsQuery.data ?? []
  const ledgerRows = ledgerQuery.data ?? []
  const loadingShift =
    Boolean(shiftId) &&
    (expensesQuery.isLoading ||
      collectionsQuery.isLoading ||
      transfersQuery.isLoading ||
      adjustmentsQuery.isLoading)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t.treasury.drawerMovements.title(drawerName)}
          </DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-xs">
          {t.treasury.drawerMovements.hint}
        </p>

        {openShift ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {t.treasury.drawerMovements.drawerCash}
              </span>
              <span className="text-lg font-bold" dir="ltr">
                {formatMoney(drawerBal)}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {t.treasury.shift.openShiftRef(openShift.reference)}
            </p>
            {channels.length > 0 ? (
              <div className="mt-2 space-y-1 border-t pt-2">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  {t.treasury.drawerMovements.shiftChannels}
                </p>
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between text-xs"
                  >
                    <span>{ch.name}</span>
                    <span dir="ltr" className="font-medium">
                      {formatMoney(Number(ch.balance ?? 0))}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t.treasury.drawerMovements.noOpenShift}
          </p>
        )}

        {loadingShift ? (
          <LoadingState />
        ) : openShift ? (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pe-1">
            <Section title={t.treasury.drawerMovements.expenses}>
              {expenses.length === 0 ? (
                <Empty />
              ) : (
                expenses.map((row) => (
                  <Row
                    key={row.id}
                    title={row.description || '—'}
                    meta={`${formatDateTime(row.created_at)} · ${statusLabel(row.status)}`}
                    amount={row.amount}
                    action={
                      <RejectBtn
                        enabled={
                          row.status === 'executed' || row.status === 'pending'
                        }
                        onClick={() => {
                          setReasonError(null)
                          setTarget({ kind: 'expense', id: row.id })
                        }}
                      />
                    }
                  />
                ))
              )}
            </Section>

            <Section title={t.treasury.drawerMovements.collections}>
              {collections.length === 0 ? (
                <Empty />
              ) : (
                collections.map((row) => (
                  <Row
                    key={row.id}
                    title={`${row.method} · ${row.order_ref}`}
                    meta={`${row.reference} · ${formatDateTime(row.created_at)} · ${collectionStatusLabel(row.status)}`}
                    amount={row.net}
                    action={
                      <RejectBtn
                        enabled={
                          row.status === 'approved' || row.status === 'pending'
                        }
                        onClick={() => {
                          setReasonError(null)
                          setTarget({ kind: 'collection', id: row.id })
                        }}
                      />
                    }
                  />
                ))
              )}
            </Section>

            <Section title={t.treasury.drawerMovements.transfers}>
              {transfers.length === 0 ? (
                <Empty />
              ) : (
                transfers.map((row) => (
                  <Row
                    key={row.id}
                    title={row.route}
                    meta={`${row.reason || '—'} · ${formatDateTime(row.created_at)} · ${statusLabel(row.status)}`}
                    amount={row.amount}
                    action={
                      <RejectBtn
                        enabled={
                          row.status === 'executed' || row.status === 'pending'
                        }
                        onClick={() => {
                          setReasonError(null)
                          setTarget({ kind: 'transfer', id: row.id })
                        }}
                      />
                    }
                  />
                ))
              )}
            </Section>

            <Section title={t.treasury.drawerMovements.adjustments}>
              {adjustments.length === 0 ? (
                <Empty />
              ) : (
                adjustments.map((row) => (
                  <Row
                    key={row.id}
                    title={
                      row.kind === 'deposit'
                        ? t.treasury.adjustments.kindDeposit
                        : t.treasury.adjustments.kindWithdrawal
                    }
                    meta={`${row.reason || '—'} · ${formatDateTime(row.created_at)} · ${statusLabel(row.status)}`}
                    amount={row.amount}
                    action={
                      <RejectBtn
                        enabled={
                          row.status === 'executed' || row.status === 'pending'
                        }
                        onClick={() => {
                          setReasonError(null)
                          setTarget({ kind: 'adjustment', id: row.id })
                        }}
                      />
                    }
                  />
                ))
              )}
            </Section>
          </div>
        ) : null}

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-bold">
            {t.treasury.drawerMovements.cashLedger}
          </p>
          {ledgerQuery.isLoading ? (
            <LoadingState />
          ) : ledgerRows.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {t.treasury.overview.ledgerEmpty}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.treasury.common.date}</TableHead>
                    <TableHead>{t.treasury.common.reference}</TableHead>
                    <TableHead>{t.treasury.common.status}</TableHead>
                    <TableHead className="text-end">
                      {t.treasury.common.amount}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(row.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.reference ?? t.treasury.common.none}
                      </TableCell>
                      <TableCell className="text-xs">
                        {t.treasury.movementSource[row.source]}
                      </TableCell>
                      <TableCell
                        className={`text-end font-medium ${row.amount < 0 ? 'text-destructive' : 'text-success'}`}
                      >
                        {formatMoney(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <ReasonDialog
          open={target !== null}
          title={t.treasury.lifecycle.rejectTitle}
          hint={t.treasury.lifecycle.rejectHint}
          confirmLabel={t.treasury.lifecycle.reject}
          destructive
          pending={
            rejectMut.isPending ||
            rejectTransfer.isPending ||
            rejectAdjustment.isPending
          }
          submitError={reasonError}
          onConfirm={(reason) => rejectMut.mutate(reason)}
          onOpenChange={(next) => !next && setTarget(null)}
        />
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-bold">{title}</p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}

function Empty() {
  return (
    <li className="text-muted-foreground text-xs">
      {t.treasury.drawerMovements.empty}
    </li>
  )
}

function Row({
  title,
  meta,
  amount,
  action,
}: {
  title: string
  meta: string
  amount: number
  action: ReactNode
}) {
  return (
    <li
      className={cn(
        'flex items-start justify-between gap-2 rounded-lg border bg-background px-2 py-1.5 text-xs',
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold">{title}</p>
        <p className="text-muted-foreground truncate">{meta}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span dir="ltr" className="font-bold">
          {formatMoney(amount)}
        </span>
        {action}
      </div>
    </li>
  )
}

function statusLabel(status: string): string {
  const map = t.treasury.status as Record<string, string>
  return map[status] ?? status
}

function collectionStatusLabel(status: string): string {
  const map = t.orders.status.collection as Record<string, string>
  return map[status] ?? status
}
