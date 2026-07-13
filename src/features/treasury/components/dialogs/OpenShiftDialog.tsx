import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { PendingHandover } from '@/features/treasury/api/treasury.api'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useOpenShift } from '@/features/treasury/hooks/useTreasuryMutations'
import { usePendingHandovers } from '@/features/treasury/hooks/useTreasuryQueries'
import {
  openShiftSchema,
  type OpenShiftFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
import { formatMoney } from '@/features/treasury/utils/format'
import { printShiftHandoverReceipt } from '@/features/treasury/utils/printHandoverReceipt'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { useSession } from '@/shared/session/SessionProvider'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional override from POS context */
  pendingNext?: PendingHandover | null
}

function varianceLabel(variance: number): string {
  if (Math.abs(variance) < 0.001) return t.treasury.shift.receiveVarianceNone
  if (variance < 0) {
    return t.treasury.shift.receiveVarianceShort(formatMoney(Math.abs(variance)))
  }
  return t.treasury.shift.receiveVarianceOver(formatMoney(variance))
}

export function OpenShiftDialog({ open, onOpenChange, pendingNext }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useOpenShift()
  const pendingQ = usePendingHandovers()
  const { staff } = useSession()
  const fromList = (pendingQ.data ?? []).find((h) => h.kind === 'to_next_shift')
  const nextHandover = pendingNext ?? fromList ?? null

  const form = useForm<OpenShiftFormValues>({
    resolver: zodResolver(openShiftSchema),
    defaultValues: { openingFloat: 0, receivedActualCash: undefined },
  })

  useEffect(() => {
    if (open) {
      form.reset({ openingFloat: 0, receivedActualCash: undefined })
      setSubmitError(null)
    }
  }, [open, form])

  const ownCash = form.watch('openingFloat')
  const receivedActual = form.watch('receivedActualCash')
  const expected = Number(nextHandover?.amount ?? 0)
  const receivedOk = Number.isFinite(receivedActual)
  const receiveDiff = receivedOk ? Number(receivedActual) - expected : 0
  const startingTotal = useMemo(() => {
    const float = Number.isFinite(ownCash) ? Number(ownCash) : 0
    if (nextHandover) {
      const counted = receivedOk ? Number(receivedActual) : expected
      return counted + float
    }
    return float
  }, [nextHandover, ownCash, receivedActual, receivedOk, expected])
  const sourceVariance = Number(nextHandover?.source_variance ?? 0)

  function onSubmit(values: OpenShiftFormValues) {
    setSubmitError(null)
    if (nextHandover) {
      if (!Number.isFinite(values.receivedActualCash)) {
        setSubmitError(t.treasury.shift.receiveCountRequired)
        return
      }
      mutation.mutate(
        {
          openingFloat: values.openingFloat,
          receiveHandoverId: nextHandover.id,
          receivedActualCash: values.receivedActualCash,
        },
        {
          onSuccess: () => {
            toast.success(
              t.treasury.handover.receivedConfirm(
                nextHandover.reference,
                formatMoney(Number(nextHandover.amount)),
              ),
            )
            toast.message(
              t.treasury.shift.receiveStartedWith(formatMoney(startingTotal)),
            )
            void printShiftHandoverReceipt(nextHandover.id, 'receive', {
              kind: 'receive',
              reference: nextHandover.reference,
              shiftReference: nextHandover.shift_reference,
              cashierName: nextHandover.cashier_name ?? '—',
              amount: Number(nextHandover.amount),
              destination: 'to_next_shift',
              at: new Date().toISOString(),
              receivedByName: staff?.display_name ?? null,
            }).then((via) => {
              toast.message(
                via === 'bridge'
                  ? t.treasury.handover.receiptQueuedBridge
                  : t.treasury.handover.receiptPrinted,
              )
            })
            onOpenChange(false)
          },
          onError: (e: Error) => setSubmitError(e.message),
        },
      )
      return
    }
    mutation.mutate(
      { openingFloat: values.openingFloat },
      {
        onSuccess: () => {
          toast.success(t.treasury.shift.opened)
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  const receiveBlocked =
    Boolean(nextHandover) && !Number.isFinite(form.watch('receivedActualCash'))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {nextHandover
              ? t.treasury.shift.receiveNextTitle
              : t.treasury.shift.openTitle}
          </DialogTitle>
        </DialogHeader>
        <form
          id="open-shift-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {nextHandover ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border bg-[#f8fafc] p-3 space-y-2">
                <p className="text-center text-base font-bold">
                  {t.treasury.shift.receiveDoneHeading}
                </p>
                <Row
                  label={t.treasury.shift.receiveFrom}
                  value={nextHandover.cashier_name ?? '—'}
                />
                <Row
                  label={t.treasury.shift.receiveShiftRef}
                  value={nextHandover.shift_reference}
                  ltr
                />
                <Row
                  label={t.treasury.handover.receiptRef}
                  value={nextHandover.reference}
                  ltr
                />
              </div>

              <div className="rounded-xl border p-3 space-y-2">
                <Row
                  label={t.treasury.shift.receiveCountExpected}
                  value={formatMoney(expected)}
                  emphasize
                  ltr
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="received-actual-cash" required>
                  {t.treasury.shift.receiveCountLabel}
                </Label>
                <Input
                  id="received-actual-cash"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  {...form.register('receivedActualCash', {
                    valueAsNumber: true,
                  })}
                />
                <p className="text-muted-foreground text-xs">
                  {t.treasury.shift.receiveCountHint}
                </p>
                <FieldError
                  message={form.formState.errors.receivedActualCash?.message}
                />
              </div>

              {receivedOk ? (
                <div className="rounded-xl border p-3">
                  <Row
                    label={t.treasury.shift.receiveCountDiff}
                    value={formatMoney(receiveDiff)}
                    emphasize
                    ltr
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="opening-float">
                  {t.treasury.shift.receiveOwnCash}
                </Label>
                <Input
                  id="opening-float"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  {...form.register('openingFloat', { valueAsNumber: true })}
                />
                <p className="text-muted-foreground text-xs">
                  {t.treasury.shift.receiveOwnCashHint}
                </p>
                <FieldError
                  message={form.formState.errors.openingFloat?.message}
                />
              </div>

              <div className="rounded-xl border border-[#86efac] bg-[#f0fdf4] p-3">
                <Row
                  label={t.treasury.shift.receiveStartingTotal}
                  value={formatMoney(startingTotal)}
                  emphasize
                  ltr
                />
              </div>

              {Math.abs(sourceVariance) > 0.001 ? (
                <Alert className="border-amber-300 bg-amber-50">
                  <AlertDescription className="text-amber-950">
                    <p className="font-semibold">
                      {t.treasury.shift.receiveVarianceHeading}
                    </p>
                    <p className="mt-1">{varianceLabel(sourceVariance)}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.treasury.shift.receiveVarianceNote}
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="opening-float" required>
                {t.treasury.shift.openingFloat}
              </Label>
              <Input
                id="opening-float"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                {...form.register('openingFloat', { valueAsNumber: true })}
              />
              <p className="text-muted-foreground text-xs">
                {t.treasury.shift.openingFloatHint}
              </p>
              <FieldError message={form.formState.errors.openingFloat?.message} />
            </div>
          )}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="open-shift-form"
            loading={mutation.isPending}
            disabled={receiveBlocked || mutation.isPending}
          >
            {nextHandover
              ? t.treasury.shift.receiveNextConfirm
              : t.treasury.shift.open}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  label,
  value,
  emphasize,
  ltr,
}: {
  label: string
  value: string
  emphasize?: boolean
  ltr?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={emphasize ? 'text-base font-bold' : 'font-semibold'}
        dir={ltr ? 'ltr' : undefined}
      >
        {value}
      </span>
    </div>
  )
}
