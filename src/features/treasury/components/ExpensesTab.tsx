import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifecycleActions } from '@/features/treasury/components/LifecycleActions'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { ExpenseDialog } from '@/features/treasury/components/dialogs/ExpenseDialog'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import {
  isInsufficientOperatingError,
  ReleaseReservedDialog,
} from '@/features/treasury/components/dialogs/ReleaseReservedDialog'
import { useRejectExpense } from '@/features/treasury/hooks/useTreasuryMutations'
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

export function ExpensesTab({ expenses, treasuries }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseSuggest, setReleaseSuggest] = useState<number | null>(null)

  const reject = useRejectExpense()

  const name = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string) => map.get(id) ?? t.treasury.common.none
  }, [treasuries])

  function onConfirmReason(text: string) {
    if (!rejectId) return
    setReasonError(null)
    const row = expenses.find((e) => e.id === rejectId)
    reject.mutate(
      { id: rejectId, reason: text },
      {
        onSuccess: () => {
          toast.success(t.treasury.lifecycle.rejected)
          setRejectId(null)
        },
        onError: (e: Error) => {
          if (isInsufficientOperatingError(e.message)) {
            setReleaseSuggest(Number(row?.amount ?? 0) || null)
            setReleaseOpen(true)
            return
          }
          setReasonError(e.message)
        },
      },
    )
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
                      onReject={() => {
                        setReasonError(null)
                        setRejectId(ex.id)
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
        open={rejectId !== null}
        title={t.treasury.lifecycle.rejectTitle}
        hint={t.treasury.lifecycle.rejectHint}
        confirmLabel={t.treasury.lifecycle.reject}
        destructive
        pending={reject.isPending}
        submitError={reasonError}
        onConfirm={onConfirmReason}
        onOpenChange={(next) => !next && setRejectId(null)}
      />
      <ReleaseReservedDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        suggestedAmount={releaseSuggest}
      />
    </Card>
  )
}
