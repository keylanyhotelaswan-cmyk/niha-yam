import { useState } from 'react'
import { ArrowDownUp, Bike, Wallet } from 'lucide-react'
import { DeliveryDriversDialog } from '@/features/drivers/components/DeliveryDriversDialog'
import { LiquidityPanel } from '@/features/treasury/components/LiquidityPanel'
import { PendingHandoverBanner } from '@/features/treasury/components/PendingHandoverBanner'
import { usePendingHandovers } from '@/features/treasury/hooks/useTreasuryQueries'
import { CashDropDialog } from '@/features/treasury/components/dialogs/CashDropDialog'
import { CloseShiftDialog } from '@/features/treasury/components/dialogs/CloseShiftDialog'
import { LedgerDialog } from '@/features/treasury/components/dialogs/LedgerDialog'
import { OpenShiftDialog } from '@/features/treasury/components/dialogs/OpenShiftDialog'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { OpenShift, TreasuryBalance } from '@/features/treasury/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { t } from '@/shared/i18n'

type Props = {
  balances: TreasuryBalance[]
  openShift: OpenShift | null
}

type LedgerState = { id: string; name: string } | null

export function OverviewTab({ balances, openShift }: Props) {
  const [openShiftDialog, setOpenShiftDialog] = useState(false)
  const [closeShiftDialog, setCloseShiftDialog] = useState(false)
  const [cashDropDialog, setCashDropDialog] = useState(false)
  const [driversOpen, setDriversOpen] = useState(false)
  const [ledger, setLedger] = useState<LedgerState>(null)
  const pendingHandovers = usePendingHandovers()
  const hasPendingHandover = (pendingHandovers.data ?? []).length > 0

  return (
    <div className="space-y-6">
      <PendingHandoverBanner />
      <LiquidityPanel />

      {/* Shift */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.treasury.shift.heading}</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={hasPendingHandover}
              title={
                hasPendingHandover
                  ? t.treasury.handover.cashDropBlocked
                  : undefined
              }
              onClick={() => setCashDropDialog(true)}
            >
              <ArrowDownUp className="size-4" aria-hidden />
              {t.treasury.cashDrop.action}
            </Button>
            {openShift ? (
              <Button size="sm" onClick={() => setCloseShiftDialog(true)}>
                {t.treasury.shift.close}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setOpenShiftDialog(true)}>
                {t.treasury.shift.open}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDriversOpen(true)}
            >
              <Bike className="size-4" aria-hidden />
              {t.drivers.manage}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {openShift ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">
                  {t.treasury.shift.openShiftRef(openShift.reference)}
                </p>
                <p className="text-sm">
                  {t.treasury.shift.openedAt}:{' '}
                  {formatDateTime(openShift.opened_at)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-xs font-semibold">
                  {t.treasury.shift.reportHeading}
                </p>
                <ShiftSummary report={openShift} showApprovalMetrics />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t.treasury.shift.noOpenShift}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Balances */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">
          {t.treasury.overview.balancesHeading}
        </h2>
        {balances.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t.treasury.overview.emptyTreasuries}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <Card key={b.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      <Wallet className="text-muted-foreground size-4" aria-hidden />
                      {b.name}
                    </span>
                    {!b.is_active ? (
                      <Badge variant="secondary">
                        {t.treasury.overview.inactive}
                      </Badge>
                    ) : b.is_shift_drawer ? (
                      <Badge variant="info">{t.treasury.overview.drawer}</Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-2xl font-bold">{formatMoney(b.balance)}</p>
                  {b.is_shift_drawer && openShift?.operational_drawer_balance != null ? (
                    <p className="text-muted-foreground text-xs">
                      {t.treasury.shift.operationalDrawer}:{' '}
                      <span className="text-foreground font-semibold" dir="ltr">
                        {formatMoney(
                          Number(openShift.operational_drawer_balance),
                        )}
                      </span>
                    </p>
                  ) : null}
                  <div className="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p>{t.treasury.overview.totalIn}</p>
                      <p className="text-success font-medium">
                        {formatMoney(b.total_in)}
                      </p>
                    </div>
                    <div>
                      <p>{t.treasury.overview.totalOut}</p>
                      <p className="text-destructive font-medium">
                        {formatMoney(b.total_out)}
                      </p>
                    </div>
                    <div>
                      <p>{t.treasury.overview.operations}</p>
                      <p className="text-foreground font-medium">
                        {b.movement_count}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLedger({ id: b.id, name: b.name })}
                  >
                    {t.treasury.overview.viewLedger}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <OpenShiftDialog
        open={openShiftDialog}
        onOpenChange={setOpenShiftDialog}
      />
      <CloseShiftDialog
        open={closeShiftDialog}
        shift={openShift}
        onOpenChange={setCloseShiftDialog}
      />
      <CashDropDialog open={cashDropDialog} onOpenChange={setCashDropDialog} />
      <DeliveryDriversDialog open={driversOpen} onOpenChange={setDriversOpen} />
      {ledger ? (
        <LedgerDialog
          open
          treasuryId={ledger.id}
          treasuryName={ledger.name}
          onOpenChange={(next) => !next && setLedger(null)}
        />
      ) : null}
    </div>
  )
}
