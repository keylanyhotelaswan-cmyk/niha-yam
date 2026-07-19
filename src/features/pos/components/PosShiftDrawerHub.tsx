import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import {
  rejectCollection,
  rejectExpense,
} from '@/features/orders/api/orders.api'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import { useRejectTransfer } from '@/features/treasury/hooks/useTreasuryMutations'
import { supabase } from '@/lib/supabase/client'
import { usePermissions } from '@/shared/access/permissions'
import { Button } from '@/shared/components/ui/button'
import type { ShiftReport } from '@/features/treasury/types'
import type { PosOperationalTreasury } from '@/features/pos/types'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  shift: ShiftReport | null
  operationalTreasuries?: PosOperationalTreasury[]
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
  method_code: string
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

type RejectTarget =
  | { kind: 'expense'; id: string }
  | { kind: 'collection'; id: string }
  | { kind: 'transfer'; id: string }

export function PosShiftDrawerHub({ shift, operationalTreasuries = [] }: Props) {
  const shiftId = shift?.id ?? null
  const { can } = usePermissions()
  const canReject = can('treasury.manage')
  const queryClient = useQueryClient()
  const rejectTransfer = useRejectTransfer()
  const [target, setTarget] = useState<RejectTarget | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const drawer = operationalTreasuries.find((tr) => tr.code === 'drawer')
  const channels = operationalTreasuries.filter((tr) => tr.code !== 'drawer')

  const expensesQuery = useQuery({
    queryKey: ['pos', 'drawer-hub-expenses', shiftId],
    enabled: Boolean(shiftId),
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, amount, description, status, created_at')
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))
    },
  })

  const collectionsQuery = useQuery({
    queryKey: ['pos', 'drawer-hub-collections', shiftId],
    enabled: Boolean(shiftId),
    queryFn: async (): Promise<CollectionRow[]> => {
      const { data, error } = await supabase
        .from('order_payments')
        .select(
          'id, amount, change_given, net_amount, reference, collection_status, created_at, payment_method_id, order_id',
        )
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(40)
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
          method_code: pm?.code ?? '',
          reference: r.reference,
          status: r.collection_status,
          order_ref: ordMap.get(r.order_id) ?? '—',
          created_at: r.created_at,
        }
      })
    },
  })

  const transfersQuery = useQuery({
    queryKey: ['pos', 'drawer-hub-transfers', shiftId],
    enabled: Boolean(shiftId),
    queryFn: async (): Promise<TransferRow[]> => {
      const { data, error } = await supabase
        .from('treasury_transfers')
        .select(
          'id, amount, reason, status, created_at, source_treasury_id, dest_treasury_id',
        )
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(30)
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

  function refresh() {
    void expensesQuery.refetch()
    void collectionsQuery.refetch()
    void transfersQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: posKeys.context() })
  }

  const rejectMut = useMutation({
    mutationFn: async (reason: string) => {
      if (!target) throw new Error('NO_TARGET')
      if (target.kind === 'expense') await rejectExpense(target.id, reason)
      else if (target.kind === 'collection')
        await rejectCollection(target.id, reason)
      else
        await new Promise<void>((resolve, reject) => {
          rejectTransfer.mutate(
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

  if (!shift) return null

  const drawerBal = Number(
    drawer?.balance ?? shift.operational_drawer_balance ?? shift.expected_cash ?? 0,
  )

  function RejectBtn(props: {
    enabled: boolean
    onClick: () => void
  }) {
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

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-[#cbd5e1] bg-white p-3 text-sm">
      <div>
        <p className="font-bold text-[#0f172a]">{t.pos.drawerHub.title}</p>
        <p className="text-muted-foreground text-xs">{t.pos.drawerHub.hint}</p>
      </div>

      <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t.pos.drawerHub.drawerCash}</span>
          <span className="text-lg font-bold" dir="ltr">
            {formatMoney(drawerBal)}
          </span>
        </div>
        {channels.length > 0 ? (
          <div className="mt-2 space-y-1 border-t pt-2">
            <p className="text-[11px] font-semibold text-[#64748b]">
              {t.pos.drawerHub.shiftChannels}
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

      <Section title={t.pos.drawerHub.expenses}>
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
                  enabled={row.status === 'executed' || row.status === 'pending'}
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

      <Section title={t.pos.drawerHub.collections}>
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

      <Section title={t.pos.drawerHub.transfers}>
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
                  enabled={row.status === 'executed' || row.status === 'pending'}
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

      <ReasonDialog
        open={target !== null}
        title={t.treasury.lifecycle.rejectTitle}
        hint={t.treasury.lifecycle.rejectHint}
        confirmLabel={t.treasury.lifecycle.reject}
        destructive
        pending={rejectMut.isPending || rejectTransfer.isPending}
        submitError={reasonError}
        onConfirm={(reason) => rejectMut.mutate(reason)}
        onOpenChange={(next) => !next && setTarget(null)}
      />
    </div>
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
      <p className="text-xs font-bold text-[#334155]">{title}</p>
      <ul className="max-h-40 space-y-1.5 overflow-y-auto">{children}</ul>
    </div>
  )
}

function Empty() {
  return (
    <li className="text-muted-foreground text-xs">{t.pos.drawerHub.empty}</li>
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
        'flex items-start justify-between gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1.5 text-xs',
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold text-[#0f172a]">{title}</p>
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
