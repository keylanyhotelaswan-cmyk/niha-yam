import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import { fetchPendingExpenses, rejectExpense } from '@/features/orders/api/orders.api'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import { supabase } from '@/lib/supabase/client'
import { usePermissions } from '@/shared/access/permissions'
import { Button } from '@/shared/components/ui/button'
import type { ShiftReport } from '@/features/treasury/types'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { t } from '@/shared/i18n'

type Props = {
  shift: ShiftReport | null
  showDetails?: boolean
}

type ExpenseRow = {
  id: string
  amount: number
  description: string | null
  vendor: string | null
  status: string
  created_at: string
}

export function PosShiftExpensesPanel({ shift, showDetails = true }: Props) {
  const shiftId = shift?.id ?? null
  const { can } = usePermissions()
  const canReject = can('treasury.manage')
  const queryClient = useQueryClient()
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const pendingQuery = useQuery({
    queryKey: ['pos', 'shift-expenses-pending', shiftId],
    enabled: Boolean(shiftId),
    queryFn: () => fetchPendingExpenses(shiftId!),
  })

  const recentQuery = useQuery({
    queryKey: ['pos', 'shift-expenses-recent', shiftId],
    enabled: Boolean(shiftId) && showDetails,
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, amount, description, vendor, status, created_at')
        .eq('shift_id', shiftId!)
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return (data ?? []).map((row) => ({
        ...row,
        amount: Number(row.amount),
      }))
    },
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectExpense(id, reason),
    onSuccess: () => {
      toast.success(t.treasury.lifecycle.rejected)
      setRejectId(null)
      setReasonError(null)
      void recentQuery.refetch()
      void pendingQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
    },
    onError: (e: Error) => setReasonError(e.message),
  })

  if (!shift) return null

  const approved = Number(shift.expenses ?? 0)
  const pending = Number(shift.pending_expenses_amount ?? 0)
  const total = approved + pending
  const pendingRows = pendingQuery.data ?? []
  const recent = recentQuery.data ?? []

  return (
    <div className="space-y-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm">
      <p className="font-semibold text-[#0f172a]">{t.pos.ops.expensesHeading}</p>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t.pos.ops.expensesTotal}</span>
        <span dir="ltr" className="font-semibold">
          {formatMoney(total)}
        </span>
      </div>
      {pending > 0.001 ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#b45309]">{t.pos.ops.expensesPending}</span>
          <span dir="ltr" className="font-medium text-[#b45309]">
            {formatMoney(pending)}
            {shift.pending_expenses_count
              ? ` (${shift.pending_expenses_count})`
              : ''}
          </span>
        </div>
      ) : null}
      {approved > 0.001 ? (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t.pos.ops.expensesApproved}</span>
          <span dir="ltr">{formatMoney(approved)}</span>
        </div>
      ) : null}

      {showDetails && recent.length > 0 ? (
        <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto border-t pt-2 text-xs">
          {recent.map((row) => {
            const rejectable =
              canReject && (row.status === 'executed' || row.status === 'pending')
            return (
              <li key={row.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {row.description || row.vendor || '—'}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDateTime(row.created_at)}
                    {row.status === 'reversed' || row.status === 'rejected'
                      ? ` · ${t.treasury.status[row.status as 'reversed' | 'rejected']}`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span dir="ltr" className="font-semibold">
                    {formatMoney(row.amount)}
                  </span>
                  {rejectable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px] text-destructive border-destructive/40"
                      onClick={() => {
                        setReasonError(null)
                        setRejectId(row.id)
                      }}
                    >
                      {t.treasury.lifecycle.reject}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {showDetails && recent.length === 0 && pendingRows.length === 0 ? (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          {t.pos.ops.expensesEmpty}
        </p>
      ) : null}

      <ReasonDialog
        open={rejectId !== null}
        title={t.treasury.lifecycle.rejectTitle}
        hint={t.treasury.lifecycle.rejectHint}
        confirmLabel={t.treasury.lifecycle.reject}
        destructive
        pending={rejectMut.isPending}
        submitError={reasonError}
        onConfirm={(reason) => {
          if (!rejectId) return
          rejectMut.mutate({ id: rejectId, reason })
        }}
        onOpenChange={(next) => !next && setRejectId(null)}
      />
    </div>
  )
}
