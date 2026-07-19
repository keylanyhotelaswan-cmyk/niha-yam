import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { CashDropDialog } from '@/features/treasury/components/dialogs/CashDropDialog'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import { PosShiftExpensesPanel } from '@/features/pos/components/PosShiftExpensesPanel'
import { FinancialMovementDialog } from '@/features/pos/components/FinancialMovementDialog'
import { PosFeedbackDialog } from '@/features/ops-feedback/components/PosFeedbackDialog'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { useCollectionTotals } from '@/features/pos/hooks/useTodayOrderTotals'
import type { PosContext } from '@/features/pos/types'
import type { ShiftReport } from '@/features/treasury/types'
import type { OpsFeedbackContext } from '@/features/ops-feedback/api/opsFeedback.api'
import { usePermissions } from '@/shared/access/permissions'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  ctx: PosContext
  /** Auto-link context from current POS surface */
  feedbackContextType?: OpsFeedbackContext | null
  feedbackContextId?: string | null
  bridgeVersion?: string | null
}

export function PosOpsMenu({
  open,
  onOpenChange,
  ctx,
  feedbackContextType,
  feedbackContextId,
  bridgeVersion,
}: Props) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const shift = ctx.open_shift as ShiftReport | null
  const {
    collectionStatusTotals,
    paymentMethodTotals,
    trustCashTotal,
    scope,
    setScope,
    canToggleDay,
  } = useCollectionTotals({
    shiftId: shift?.id ?? null,
    allowDayScope: can('treasury.manage') || can('reports.view'),
  })
  const [shiftOpen, setShiftOpen] = useState(false)
  const [cashDropOpen, setCashDropOpen] = useState(false)
  const [financialOpen, setFinancialOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const hasShift = Boolean(shift)

  function refreshContext() {
    void queryClient.invalidateQueries({ queryKey: posKeys.context() })
    void queryClient.invalidateQueries({ queryKey: ['collection-totals'] })
  }

  function closeMenu() {
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.pos.ops.menu}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!hasShift}
              onClick={() => {
                closeMenu()
                setShiftOpen(true)
              }}
            >
              {t.pos.ops.shiftSummary}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasShift}
              onClick={() => {
                closeMenu()
                setCashDropOpen(true)
              }}
            >
              {t.pos.ops.cashDrop}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasShift}
              onClick={() => {
                closeMenu()
                setFinancialOpen(true)
              }}
            >
              {t.pos.ops.financialMovement}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                closeMenu()
                setFeedbackOpen(true)
              }}
            >
              {t.pos.ops.feedback}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.pos.ops.shiftSummary}</DialogTitle>
          </DialogHeader>
          {canToggleDay && shift ? (
            <div className="mb-2 flex gap-1">
              <button
                type="button"
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold',
                  scope === 'shift'
                    ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                    : 'border-[#e2e8f0] text-[#64748b]',
                )}
                onClick={() => setScope('shift')}
              >
                {t.orders.paymentMethods.scopeShift}
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold',
                  scope === 'day'
                    ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                    : 'border-[#e2e8f0] text-[#64748b]',
                )}
                onClick={() => setScope('day')}
              >
                {t.orders.paymentMethods.scopeDay}
              </button>
            </div>
          ) : null}
          {shift ? (
            <>
              <ShiftSummary
                report={shift}
                collectionStatusTotals={collectionStatusTotals}
                paymentMethodTotals={paymentMethodTotals}
                trustCashTotal={trustCashTotal}
              />
              <PosShiftExpensesPanel shift={shift} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <CashDropDialog
        open={cashDropOpen}
        onOpenChange={(next) => {
          setCashDropOpen(next)
          if (!next) refreshContext()
        }}
      />

      <FinancialMovementDialog
        open={financialOpen}
        treasuries={ctx.operational_treasuries}
        shiftId={shift?.id ?? null}
        canOperationalPurchase={Boolean(ctx.can_operational_purchase)}
        onOpenChange={(next) => {
          setFinancialOpen(next)
          if (!next) refreshContext()
        }}
      />

      <PosFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        contextType={feedbackContextType}
        contextId={feedbackContextId}
        bridgeVersion={bridgeVersion}
      />
    </>
  )
}
