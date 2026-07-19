import { useMemo, useState } from 'react'
import { StatusBadge } from '@/features/treasury/components/StatusBadge'
import { AdjustmentDialog } from '@/features/treasury/components/dialogs/AdjustmentDialog'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { AdjustmentRow, TreasuryRow } from '@/features/treasury/types'
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

type Props = { adjustments: AdjustmentRow[]; treasuries: TreasuryRow[] }
type CreateState = { kind: 'deposit' | 'withdrawal' } | null

export function AdjustmentsTab({ adjustments, treasuries }: Props) {
  const [create, setCreate] = useState<CreateState>(null)

  const name = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string) => map.get(id) ?? t.treasury.common.none
  }, [treasuries])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{t.treasury.adjustments.heading}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.treasury.drawerMovements.rejectFromDrawerOnly}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreate({ kind: 'deposit' })}
          >
            {t.treasury.adjustments.addDeposit}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreate({ kind: 'withdrawal' })}
          >
            {t.treasury.adjustments.addWithdrawal}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.treasury.common.reference}</TableHead>
              <TableHead>{t.treasury.adjustments.kind}</TableHead>
              <TableHead>{t.treasury.adjustments.treasury}</TableHead>
              <TableHead className="text-end">
                {t.treasury.common.amount}
              </TableHead>
              <TableHead>{t.treasury.common.status}</TableHead>
              <TableHead>{t.treasury.common.date}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  {t.treasury.adjustments.empty}
                </TableCell>
              </TableRow>
            ) : (
              adjustments.map((adj) => (
                <TableRow key={adj.id}>
                  <TableCell className="font-mono text-xs">
                    {adj.reference}
                  </TableCell>
                  <TableCell className="text-sm">
                    {adj.kind === 'deposit'
                      ? t.treasury.adjustments.kindDeposit
                      : t.treasury.adjustments.kindWithdrawal}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {name(adj.treasury_id)}
                  </TableCell>
                  <TableCell className="text-end font-medium">
                    {formatMoney(adj.amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={adj.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(adj.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {create ? (
        <AdjustmentDialog
          open
          kind={create.kind}
          treasuries={treasuries}
          onOpenChange={(next) => !next && setCreate(null)}
        />
      ) : null}
    </Card>
  )
}
