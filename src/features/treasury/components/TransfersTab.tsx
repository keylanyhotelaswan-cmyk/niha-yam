import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifecycleActions } from '@/features/treasury/components/LifecycleActions'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import { TransferDialog } from '@/features/treasury/components/dialogs/TransferDialog'
import { useRejectTransfer } from '@/features/treasury/hooks/useTreasuryMutations'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { TransferRow, TreasuryRow } from '@/features/treasury/types'
import { Badge } from '@/shared/components/ui/badge'
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

type Props = { transfers: TransferRow[]; treasuries: TreasuryRow[] }

export function TransfersTab({ transfers, treasuries }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const reject = useRejectTransfer()

  const name = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string) => map.get(id) ?? t.treasury.common.none
  }, [treasuries])

  function onConfirmReason(text: string) {
    if (!rejectId) return
    setReasonError(null)
    reject.mutate(
      { id: rejectId, reason: text },
      {
        onSuccess: () => {
          toast.success(t.treasury.lifecycle.rejected)
          setRejectId(null)
        },
        onError: (e: Error) => setReasonError(e.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>{t.treasury.transfers.heading}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t.treasury.transfers.add}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.treasury.common.reference}</TableHead>
              <TableHead>{t.treasury.transfers.colRoute}</TableHead>
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
            {transfers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  {t.treasury.transfers.empty}
                </TableCell>
              </TableRow>
            ) : (
              transfers.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-2">
                      {tr.reference}
                      {tr.is_cash_drop ? (
                        <Badge variant="info">
                          {t.treasury.transfers.cashDropBadge}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {name(tr.source_treasury_id)} → {name(tr.dest_treasury_id)}
                  </TableCell>
                  <TableCell className="text-end font-medium">
                    {formatMoney(tr.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tr.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(tr.created_at)}
                  </TableCell>
                  <TableCell className="text-end">
                    <LifecycleActions
                      status={tr.status}
                      onReject={() => {
                        setReasonError(null)
                        setRejectId(tr.id)
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <TransferDialog
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
    </Card>
  )
}
