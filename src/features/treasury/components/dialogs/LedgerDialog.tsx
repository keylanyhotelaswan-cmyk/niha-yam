import { useLedger } from '@/features/treasury/hooks/useTreasuryQueries'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
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
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  treasuryId: string
  treasuryName: string
  onOpenChange: (open: boolean) => void
}

export function LedgerDialog({
  open,
  treasuryId,
  treasuryName,
  onOpenChange,
}: Props) {
  const query = useLedger(open ? treasuryId : null)
  const rows = query.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.treasury.overview.ledgerTitle(treasuryName)}</DialogTitle>
        </DialogHeader>
        {query.isLoading ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t.treasury.overview.ledgerEmpty}
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.treasury.common.date}</TableHead>
                  <TableHead>{t.treasury.common.reference}</TableHead>
                  <TableHead>{t.treasury.common.status}</TableHead>
                  <TableHead className="text-end">
                    {t.treasury.common.amount}
                  </TableHead>
                  <TableHead>{t.treasury.common.by}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(row.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.reference ?? t.treasury.common.none}
                    </TableCell>
                    <TableCell>
                      {t.treasury.movementSource[row.source]}
                    </TableCell>
                    <TableCell
                      className={`text-end font-medium ${row.amount < 0 ? 'text-destructive' : 'text-success'}`}
                    >
                      {formatMoney(row.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {row.created_by ?? t.treasury.common.none}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
