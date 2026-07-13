import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FieldError } from '@/features/print/components/FieldError'
import {
  cancelReasonSchema,
  type CancelReasonFormValues,
} from '@/features/print/schemas/print.schemas'
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
  pending: boolean
  submitError?: string | null
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}

export function CancelJobDialog({
  open,
  pending,
  submitError,
  onConfirm,
  onOpenChange,
}: Props) {
  const form = useForm<CancelReasonFormValues>({
    resolver: zodResolver(cancelReasonSchema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (open) form.reset({ reason: '' })
  }, [open, form])

  const [localError] = useState<string | null>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.print.queue.cancelTitle}</DialogTitle>
        </DialogHeader>
        <form
          id="cancel-job-form"
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => onConfirm(v.reason))}
        >
          <p className="text-muted-foreground text-sm">
            {t.print.queue.cancelHint}
          </p>
          {submitError || localError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError ?? localError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="cancel-reason" required>
              {t.print.common.reason}
            </Label>
            <Input id="cancel-reason" {...form.register('reason')} />
            <FieldError message={form.formState.errors.reason?.message} />
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.print.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="cancel-job-form"
            variant="destructive"
            loading={pending}
          >
            {t.print.queue.cancelConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
