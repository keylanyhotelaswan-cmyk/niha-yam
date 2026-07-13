import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LifecycleActions } from '@/features/treasury/components/LifecycleActions'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import { TransferDialog } from '@/features/treasury/components/dialogs/TransferDialog'
import {
  useApproveTransfer,
  useRejectTransfer,
  useReverseTransfer,
} from '@/features/treasury/hooks/useTreasuryMutations'
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
type ReasonState = { action: 'reject' | 'reverse'; id: string } | null

export function TransfersTab({ transfers, treasuries }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [reason, setReason] = useState<ReasonState>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  const approve = useApproveTransfer()
  const reject = useRejectTransfer()
  const reverse = useReverseTransfer()

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
                      onApprove={() => onApprove(tr.id)}
                      onReject={() => {
                        setReasonError(null)
                        setReason({ action: 'reject', id: tr.id })
                      }}
                      onReverse={() => {
                        setReasonError(null)
                        setReason({ action: 'reverse', id: tr.id })
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
