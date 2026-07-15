import { useQuery } from '@tanstack/react-query'
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import { fetchPendingExpenses } from '@/features/orders/api/orders.api'
import { supabase } from '@/lib/supabase/client'
import type { ShiftReport } from '@/features/treasury/types'
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
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto border-t pt-2 text-xs">
          {recent.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {row.description || row.vendor || '—'}
                </p>
                <p className="text-muted-foreground">
                  {formatDateTime(row.created_at)}
                </p>
              </div>
              <span dir="ltr" className="shrink-0 font-semibold">
                {formatMoney(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {showDetails && recent.length === 0 && pendingRows.length === 0 ? (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          {t.pos.ops.expensesEmpty}
        </p>
      ) : null}
    </div>
  )
}
