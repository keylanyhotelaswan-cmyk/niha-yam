import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifecycleActions } from '@/features/treasury/components/LifecycleActions'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { ExpenseDialog } from '@/features/treasury/components/dialogs/ExpenseDialog'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import {
  useApproveExpense,
  useRejectExpense,
  useReverseExpense,
} from '@/features/treasury/hooks/useTreasuryMutations'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { ExpenseRow, TreasuryRow } from '@/features/treasury/types'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'

type Props = { expenses: ExpenseRow[]; treasuries: TreasuryRow[] }
type ReasonState = { action: 'reject' | 'reverse'; id: string } | null

export function ExpensesTab({ expenses, treasuries }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [reason, setReason] = useState<ReasonState>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const approve = useApproveExpense()
  const reject = useRejectExpense()
  const reverse = useReverseExpense()

  const name = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string) => map.get(id) ?? t.treasury.common.none
  }, [treasuries])

  function onApprove(id: string) {
    approve.mutate(id, {
      onSuccess: () => toast.success(t.treasury.lifecycle.approved),
      onError: (e: Error) => toast.error(e.message),
    })
  }

  function onConfirmReason(text: string) {
    if (!reason) return
    setReasonError(null)
    const opts = {
      onSuccess: () => {
        toast.success(
          reason.action === 'reject'
            ? t.treasury.lifecycle.rejected
            : t.treasury.lifecycle.reversed,
        )
        setReason(null)
      },
      onError: (e: Error) => setReasonError(e.message),
    }
    if (reason.action === 'reject') {
      reject.mutate({ id: reason.id, reason: text }, opts)
    } else {
      reverse.mutate({ id: reason.id, reason: text }, opts)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>{t.treasury.expenses.heading}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t.treasury.expenses.add}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.treasury.common.reference}</TableHead>
              <TableHead>{t.treasury.expenses.category}</TableHead>
              <TableHead>{t.treasury.expenses.treasury}</TableHead>
              <TableHead className="text-end">
                {t.treasury.common.amount}
              </TableHead>
              <TableHead>{t.treasury.common.status}</TableHead>
              <TableHead>{t.treasury.common.date}</TableHead>
              <TableHead className="w-16 text-end">
                {t.treasury.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  {t.treasury.expenses.empty}
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell className="font-mono text-xs">
                    {ex.reference}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.treasury.expenseCategory[ex.category]}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {name(ex.treasury_id)}
                  </TableCell>
                  <TableCell className="text-end font-medium">
                    {formatMoney(ex.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ex.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(ex.created_at)}
                  </TableCell>
                  <TableCell className="text-end">
                    <LifecycleActions
                      status={ex.status}
                      onApprove={() => onApprove(ex.id)}
                      onReject={() => {
                        setReasonError(null)
                        setReason({ action: 'reject', id: ex.id })
                      }}
                      onReverse={() => {
                        setReasonError(null)
                        setReason({ action: 'reverse', id: ex.id })
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <ExpenseDialog
        open={createOpen}
        treasuries={treasuries}
        onOpenChange={setCreateOpen}
      />
      <ReasonDialog
        open={reason !== null}
        title={
          reason?.action === 'reject'
            ? t.treasury.lifecycle.rejectTitle
            : t.treasury.lifecycle.reverseTitle
        }
        hint={
          reason?.action === 'reverse'
            ? t.treasury.lifecycle.reverseHint
            : undefined
        }
        confirmLabel={
          reason?.action === 'reject'
            ? t.treasury.lifecycle.reject
            : t.treasury.lifecycle.reverse
        }
        destructive
        pending={reject.isPending || reverse.isPending}
        submitError={reasonError}
        onConfirm={onConfirmReason}
        onOpenChange={(next) => !next && setReason(null)}
      />
    </Card>
  )
}
