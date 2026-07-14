import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import { CollectionApprovalDialog } from '@/features/orders/components/CollectionApprovalDialog'
import {
  approvePendingForShift,
  parsePendingExpensesSummary,
  parsePendingSummary,
} from '@/features/orders/api/orders.api'
import { useCloseShift } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  closeShiftSchema,
  type CloseShiftFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
import type { OpenShift } from '@/features/treasury/types'
import { formatMoney } from '@/features/treasury/utils/format'
import { printShiftHandoverReceipt } from '@/features/treasury/utils/printHandoverReceipt'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
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
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  shift: OpenShift | null
  onOpenChange: (open: boolean) => void
  /**
   * When false (cashier), skip the F1 approval step — that stays an admin control surface.
   * Backend pending/approval rules are unchanged; cashier just continues to count/close.
   */
  showApprovalStep?: boolean
}

type Step = 'approval' | 'count' | 'destination'

export function CloseShiftDialog({
  open,
  shift,
  onOpenChange,
  showApprovalStep = true,
}: Props) {
  const queryClient = useQueryClient()
  const expectedCash = shift?.expected_cash ?? 0
  const pendingSummary = parsePendingSummary(shift as Record<string, unknown> | null)
  const expenseSummary = parsePendingExpensesSummary(
    shift as Record<string, unknown> | null,
  )
  const pendingCount =
    pendingSummary?.count ?? Number(shift?.pending_collections_count ?? 0)
  const pendingExpCount =
    expenseSummary?.count ?? Number(shift?.pending_expenses_count ?? 0)
  const totalPending = pendingCount + pendingExpCount
  const [step, setStep] = useState<Step>('count')
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useCloseShift()
  const form = useForm<CloseShiftFormValues>({
    resolver: zodResolver(closeShiftSchema),
    defaultValues: {
      actualCashCount: 0,
      differenceReason: '',
      notes: '',
      destination: undefined as unknown as 'to_main',
    },
  })

  useEffect(() => {
    if (open) {
      setStep(
        showApprovalStep && totalPending > 0 ? 'approval' : 'count',
      )
      form.reset({
        actualCashCount: 0,
        differenceReason: '',
        notes: '',
        destination: undefined as unknown as 'to_main',
      })
      setSubmitError(null)
    }
  }, [open, form, totalPending, showApprovalStep])

  const approveAllMut = useMutation({
    mutationFn: () => approvePendingForShift(shift!.id),
    onSuccess: (result) => {
      toast.success(
        t.orders.approval.approvedAll(
          result.approved_count,
          result.approved_expenses_count,
        ),
      )
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
      void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
      setStep('count')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const actual = form.watch('actualCashCount')
  const destination = form.watch('destination')
  const difference = (Number.isFinite(actual) ? actual : 0) - expectedCash
  const hasDifference = Math.abs(difference) > 0.001

  function goDestination() {
    setSubmitError(null)
    if (hasDifference && !form.getValues('differenceReason')?.trim()) {
      form.setError('differenceReason', {
        message: t.treasury.shift.differenceReasonRequired,
      })
      return
    }
    setStep('destination')
  }

  function onSubmit(values: CloseShiftFormValues) {
    setSubmitError(null)
    if (!values.destination) {
      setSubmitError(t.treasury.shift.destinationRequired)
      return
    }
    mutation.mutate(
      {
        actualCashCount: values.actualCashCount,
        differenceReason: values.differenceReason?.trim() || null,
        notes: values.notes?.trim() || null,
        destination: values.destination!,
      },
      {
        onSuccess: (result) => {
          toast.success(t.treasury.shift.closedWithHandover)
          void printShiftHandoverReceipt(result.handover_id, 'handover', {
            kind: 'handover',
            reference: result.reference,
            shiftReference: shift?.reference ?? result.shift_id,
            cashierName: result.cashier_name,
            amount: Number(result.amount),
            destination: result.kind,
            at: new Date().toISOString(),
          }).then((via) => {
            toast.message(
              via === 'bridge'
                ? t.treasury.handover.receiptQueuedBridge
                : t.treasury.handover.receiptPrinted,
            )
          })
          void queryClient.invalidateQueries({ queryKey: posKeys.context() })
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.treasury.shift.closeTitle}</DialogTitle>
          </DialogHeader>

          {step === 'approval' && totalPending > 0 ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {t.treasury.shift.pendingBeforeClose(
                    pendingCount,
                    pendingExpCount,
                  )}
                </AlertDescription>
              </Alert>
              {shift ? (
                <div className="bg-muted/40 rounded-md p-3">
                  <ShiftSummary report={shift} showApprovalMetrics />
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={approveAllMut.isPending || !shift}
                onClick={() => approveAllMut.mutate()}
              >
                {t.orders.approval.approveAll}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setApprovalOpen(true)}
              >
                {t.orders.approval.reviewExceptions}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('count')}
              >
                {t.treasury.shift.closeWithPendingWarn}
              </Button>
            </div>
          ) : null}

          {step === 'count' ? (
            <form
              id="close-shift-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void form.trigger().then((ok) => {
                  if (ok) goDestination()
                })
              }}
            >
              {submitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {t.treasury.shift.countHeading}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.treasury.shift.actualCashHint}
                </p>
              </div>

              <div className="bg-muted/40 flex items-center justify-between rounded-xl border p-4">
                <span className="text-muted-foreground text-sm">
                  {t.treasury.shift.expectedCashLabel}
                </span>
                <span className="text-lg font-bold" dir="ltr">
                  {formatMoney(expectedCash)}
                </span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="actual-cash" required>
                  {t.treasury.shift.actualCashCount}
                </Label>
                <Input
                  id="actual-cash"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  autoFocus
                  {...form.register('actualCashCount', { valueAsNumber: true })}
                />
                <FieldError
                  message={form.formState.errors.actualCashCount?.message}
                />
              </div>

              <div
                className={cn(
                  'flex items-center justify-between rounded-xl border p-3 text-sm',
                  hasDifference && 'border-destructive/40 bg-destructive/5',
                )}
              >
                <span className="text-muted-foreground">
                  {t.treasury.shift.variance}
                  {hasDifference
                    ? ` (${difference < 0 ? t.treasury.shift.shortage : t.treasury.shift.overage})`
                    : ''}
                </span>
                <span
                  className={
                    hasDifference
                      ? 'text-destructive font-semibold'
                      : 'font-medium'
                  }
                  dir="ltr"
                >
                  {formatMoney(difference)}
                </span>
              </div>

              {hasDifference ? (
                <div className="space-y-2">
                  <Label htmlFor="diff-reason" required>
                    {t.treasury.shift.differenceReason}
                  </Label>
                  <Input id="diff-reason" {...form.register('differenceReason')} />
                  <FieldError
                    message={form.formState.errors.differenceReason?.message}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="shift-notes">{t.treasury.shift.notes}</Label>
                <Input id="shift-notes" {...form.register('notes')} />
              </div>
            </form>
          ) : null}

          {step === 'destination' ? (
            <form
              id="close-shift-dest"
              className="space-y-4"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              {submitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}
              <p className="text-sm font-semibold">
                {t.treasury.shift.destinationHeading}
              </p>
              <div className="grid gap-3">
                {(
                  [
                    ['to_main', t.treasury.shift.destinationToMain],
                    ['to_next_shift', t.treasury.shift.destinationToNext],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      'rounded-xl border p-4 text-start text-sm font-medium transition',
                      destination === value
                        ? 'border-primary bg-primary/5 ring-primary ring-1'
                        : 'hover:bg-muted/50',
                    )}
                    onClick={() =>
                      form.setValue('destination', value, { shouldValidate: true })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </form>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={mutation.isPending}>
                {t.treasury.common.cancel}
              </Button>
            </DialogClose>
            {step === 'count' ? (
              <Button type="submit" form="close-shift-form">
                {t.treasury.shift.continueToDestination}
              </Button>
            ) : null}
            {step === 'destination' ? (
              <Button
                type="submit"
                form="close-shift-dest"
                loading={mutation.isPending}
                disabled={!destination}
              >
                {t.treasury.shift.close}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CollectionApprovalDialog
        open={approvalOpen}
        onOpenChange={(next) => {
          setApprovalOpen(next)
          if (!next) {
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
            void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
          }
        }}
        shift={shift}
      />
    </>
  )
}
