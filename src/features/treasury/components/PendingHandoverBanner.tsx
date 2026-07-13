import { useState } from 'react'
import { toast } from 'sonner'
import type { PendingHandover } from '@/features/treasury/api/treasury.api'
import { ReasonDialog } from '@/features/treasury/components/dialogs/ReasonDialog'
import {
  useReceiveTreasuryHandover,
  useRejectShiftHandover,
} from '@/features/treasury/hooks/useTreasuryMutations'
import { usePendingHandovers } from '@/features/treasury/hooks/useTreasuryQueries'
import { formatMoney } from '@/features/treasury/utils/format'
import { printShiftHandoverReceipt } from '@/features/treasury/utils/printHandoverReceipt'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { t } from '@/shared/i18n'

type Props = {
  /** When true, show Path B cards too (info only / open-shift elsewhere) */
  showNextShift?: boolean
}

export function PendingHandoverBanner({ showNextShift = true }: Props) {
  const { can } = usePermissions()
  const { staff } = useSession()
  const isManager = can('treasury.manage')
  const q = usePendingHandovers()
  const receive = useReceiveTreasuryHandover()
  const reject = useRejectShiftHandover()
  const [rejectId, setRejectId] = useState<string | null>(null)

  const items = (q.data ?? []).filter(
    (h) => h.kind === 'to_main' || (showNextShift && h.kind === 'to_next_shift'),
  )
  if (items.length === 0) return null

  function onReceive(h: PendingHandover) {
    if (h.kind !== 'to_main') return
    receive.mutate(h.id, {
      onSuccess: () => {
        toast.success(
          t.treasury.handover.receivedConfirm(
            h.reference,
            formatMoney(Number(h.amount)),
          ),
        )
        void printShiftHandoverReceipt(h.id, 'receive', {
          kind: 'receive',
          reference: h.reference,
          shiftReference: h.shift_reference,
          cashierName: h.cashier_name ?? '—',
          amount: Number(h.amount),
          destination: h.kind,
          at: new Date().toISOString(),
          receivedByName: staff?.display_name ?? null,
        }).then((via) => {
          toast.message(
            via === 'bridge'
              ? t.treasury.handover.receiptQueuedBridge
              : t.treasury.handover.receiptPrinted,
          )
        })
      },
      onError: (e: Error) => toast.error(e.message),
    })
  }

  return (
    <div className="space-y-3">
      {items.map((h) => (
        <Card
          key={h.id}
          className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-950 dark:text-amber-100">
              {t.treasury.handover.pendingTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {h.kind === 'to_main'
                ? t.treasury.handover.pendingBody(
                    h.cashier_name ?? '—',
                    formatMoney(Number(h.amount)),
                  )
                : t.treasury.handover.pendingNext(
                    h.cashier_name ?? '—',
                    formatMoney(Number(h.amount)),
                  )}
            </p>
            <p className="text-muted-foreground text-xs" dir="ltr">
              {h.reference} · {h.shift_reference}
            </p>
            {h.kind === 'to_main' && isManager ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={receive.isPending}
                  onClick={() => onReceive(h)}
                >
                  {t.treasury.handover.receiveApprove}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejectId(h.id)}
                >
                  {t.treasury.handover.reject}
                </Button>
              </div>
            ) : null}
            {h.kind === 'to_next_shift' && isManager ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectId(h.id)}
              >
                {t.treasury.handover.reject}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}

      <ReasonDialog
        open={rejectId !== null}
        title={t.treasury.handover.rejectTitle}
        confirmLabel={t.treasury.handover.reject}
        destructive
        pending={reject.isPending}
        onOpenChange={(next) => !next && setRejectId(null)}
        onConfirm={(reason) => {
          if (!rejectId) return
          reject.mutate(
            { id: rejectId, reason },
            {
              onSuccess: () => {
                toast.success(t.treasury.handover.rejected)
                setRejectId(null)
              },
              onError: (e: Error) => toast.error(e.message),
            },
          )
        }}
      />
    </div>
  )
}
