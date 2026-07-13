import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useCashDrop } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  cashDropSchema,
  type CashDropFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
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

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

export function CashDropDialog({ open, onOpenChange }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useCashDrop()
  const form = useForm<CashDropFormValues>({
    resolver: zodResolver(cashDropSchema),
    defaultValues: { amount: 0, reason: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({ amount: 0, reason: '' })
      setSubmitError(null)
    }
  }, [open, form])

  function onSubmit(values: CashDropFormValues) {
    setSubmitError(null)
    mutation.mutate(
      { amount: values.amount, reason: values.reason?.trim() || null },
      {
        onSuccess: () => {
          toast.success(t.treasury.cashDrop.done)
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.treasury.cashDrop.title}</DialogTitle>
        </DialogHeader>
        <form
          id="cash-drop-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <p className="text-muted-foreground text-sm">
            {t.treasury.cashDrop.hint}
          </p>
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="drop-amount" required>
              {t.treasury.common.amount}
            </Label>
            <Input
              id="drop-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              aria-invalid={!!form.formState.errors.amount}
              {...form.register('amount', { valueAsNumber: true })}
            />
            <FieldError message={form.formState.errors.amount?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="drop-reason">
              {t.treasury.common.reason}{' '}
              <span className="text-muted-foreground">
                ({t.treasury.common.optional})
              </span>
            </Label>
            <Input id="drop-reason" {...form.register('reason')} />
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
            form="cash-drop-form"
            loading={mutation.isPending}
          >
            {t.treasury.cashDrop.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
