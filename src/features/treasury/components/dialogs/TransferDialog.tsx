import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useCreateTransfer } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  transferSchema,
  type TransferFormValues,
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
  treasuries: TreasuryRow[]
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm'

export function TransferDialog({ open, treasuries, onOpenChange }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useCreateTransfer()
  const active = treasuries.filter((tr) => tr.is_active)

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      sourceTreasuryId: '',
      destTreasuryId: '',
      amount: 0,
      reason: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        sourceTreasuryId: active[0]?.id ?? '',
        destTreasuryId: active[1]?.id ?? '',
        amount: 0,
        reason: '',
      })
      setSubmitError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onSubmit(values: TransferFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        sourceTreasuryId: values.sourceTreasuryId,
        destTreasuryId: values.destTreasuryId,
        amount: values.amount,
        reason: values.reason?.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t.treasury.transfers.created)
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.treasury.transfers.title}</DialogTitle>
        </DialogHeader>
        <form
          id="transfer-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tr-source" required>
              {t.treasury.transfers.source}
            </Label>
            <select
              id="tr-source"
              className={selectClass}
              {...form.register('sourceTreasuryId')}
            >
              {active.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-dest" required>
              {t.treasury.transfers.dest}
            </Label>
            <select
              id="tr-dest"
              className={selectClass}
              aria-invalid={!!errors.destTreasuryId}
              {...form.register('destTreasuryId')}
            >
              {active.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
            <FieldError message={errors.destTreasuryId?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tr-amount" required>
              {t.treasury.common.amount}
            </Label>
            <Input
              id="tr-amount"
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
            <Label htmlFor="tr-reason">{t.treasury.common.reason}</Label>
            <Input id="tr-reason" {...form.register('reason')} />
            <p className="text-muted-foreground text-xs">
              {t.treasury.transfers.reasonHint}
            </p>
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
            form="transfer-form"
            loading={mutation.isPending}
          >
            {t.treasury.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
