import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useCreateAdjustment } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  adjustmentSchema,
  type AdjustmentFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
import type { TreasuryRow } from '@/features/treasury/types'
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
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  kind: 'deposit' | 'withdrawal'
  treasuries: TreasuryRow[]
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm'

export function AdjustmentDialog({
  open,
  kind,
  treasuries,
  onOpenChange,
}: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useCreateAdjustment()
  const active = treasuries.filter((tr) => tr.is_active)

  const form = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { treasuryId: '', amount: 0, reason: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ treasuryId: active[0]?.id ?? '', amount: 0, reason: '' })
      setSubmitError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onSubmit(values: AdjustmentFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        treasuryId: values.treasuryId,
        kind,
        amount: values.amount,
        reason: values.reason?.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t.treasury.adjustments.created)
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  const errors = form.formState.errors
  const title =
    kind === 'deposit'
      ? t.treasury.adjustments.depositTitle
      : t.treasury.adjustments.withdrawalTitle

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          id="adjustment-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="adj-treasury" required>
              {t.treasury.adjustments.treasury}
            </Label>
            <select
              id="adj-treasury"
              className={selectClass}
              {...form.register('treasuryId')}
            >
              {active.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-amount" required>
              {t.treasury.common.amount}
            </Label>
            <Input
              id="adj-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              aria-invalid={!!errors.amount}
              {...form.register('amount', { valueAsNumber: true })}
            />
            <FieldError message={errors.amount?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adj-reason">{t.treasury.common.reason}</Label>
            <Input id="adj-reason" {...form.register('reason')} />
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="adjustment-form"
            loading={mutation.isPending}
          >
            {t.treasury.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
