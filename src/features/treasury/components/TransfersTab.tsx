import { useMemo, useState } from 'react'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { TransferDialog } from '@/features/treasury/components/dialogs/TransferDialog'
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

  const name = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string) => map.get(id) ?? t.treasury.common.none
  }, [treasuries])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{t.treasury.transfers.heading}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.treasury.drawerMovements.rejectFromDrawerOnly}
          </p>
        </div>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
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
    </Card>
  )
}
