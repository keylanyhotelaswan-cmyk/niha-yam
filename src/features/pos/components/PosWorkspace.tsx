import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { PosOpsMenu } from '@/features/pos/components/PosOpsMenu'
import { useCollectionTotals } from '@/features/pos/hooks/useTodayOrderTotals'
import { usePosContext } from '@/features/pos/hooks/usePosQueries'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import type { OpsFeedbackContext } from '@/features/ops-feedback/api/opsFeedback.api'
import type { ShiftReport } from '@/features/treasury/types'
import { usePermissions } from '@/shared/access/permissions'
import { useOpsRealtime } from '@/shared/realtime/useOpsRealtime'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type WorkspaceApi = {
  openOps: () => void
  openShiftSummary: () => void
  setFeedbackLink: (
    type: OpsFeedbackContext | null,
    id?: string | null,
  ) => void
}

const PosWorkspaceContext = createContext<WorkspaceApi | null>(null)

export function usePosWorkspace(): WorkspaceApi {
  const ctx = useContext(PosWorkspaceContext)
  if (!ctx) {
    return {
      openOps: () => undefined,
      openShiftSummary: () => undefined,
      setFeedbackLink: () => undefined,
    }
  }
  return ctx
}

type Props = {
  children: ReactNode
}

/** Shared ops/shift dialogs — layout chrome lives in PosPage (side nav). */
export function PosWorkspace({ children }: Props) {
  useOpsRealtime(true)
  const contextQuery = usePosContext()
  const ctx = contextQuery.data
  const { can } = usePermissions()
  const shift = ctx?.open_shift as ShiftReport | null
  const {
    collectionStatusTotals,
    paymentMethodTotals,
    scope,
    setScope,
    canToggleDay,
  } = useCollectionTotals({
    shiftId: shift?.id ?? null,
    allowDayScope: can('treasury.manage') || can('reports.view'),
  })
  const [opsOpen, setOpsOpen] = useState(false)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState<OpsFeedbackContext | null>(
    null,
  )
  const [feedbackId, setFeedbackId] = useState<string | null>(null)

  const pendingHandover = (
    ctx as { pending_handovers?: Array<{ id: string }> } | undefined
  )?.pending_handovers?.[0]

  const resolvedType: OpsFeedbackContext =
    feedbackType ?? (pendingHandover ? 'handover' : shift ? 'shift' : 'none')
  const resolvedId = feedbackId ?? pendingHandover?.id ?? shift?.id ?? null

  const api: WorkspaceApi = useMemo(
    () => ({
      openOps: () => setOpsOpen(true),
      openShiftSummary: () => setShiftOpen(true),
      setFeedbackLink: (type, id) => {
        setFeedbackType(type)
        setFeedbackId(id ?? null)
      },
    }),
    [],
  )

  return (
    <PosWorkspaceContext.Provider value={api}>
      {children}
      {ctx ? (
        <PosOpsMenu
          open={opsOpen}
          onOpenChange={setOpsOpen}
          ctx={ctx}
          feedbackContextType={resolvedType}
          feedbackContextId={resolvedId}
        />
      ) : null}
      <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
        <DialogContent className="max-w-md rounded-3xl">
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
            <ShiftSummary
              report={shift}
              collectionStatusTotals={collectionStatusTotals}
              paymentMethodTotals={paymentMethodTotals}
            />
          ) : (
            <p className="text-muted-foreground text-sm">{t.pos.shift.closed}</p>
          )}
        </DialogContent>
      </Dialog>
    </PosWorkspaceContext.Provider>
  )
}
