import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FieldError } from '@/features/treasury/components/FieldError'
import {
  reasonSchema,
  type ReasonFormValues,
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

type ReasonDialogProps = {
  open: boolean
  title: string
  hint?: string
  confirmLabel: string
  destructive?: boolean
  pending: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
  submitError?: string | null
}

/** Mandatory-reason dialog shared by reject and reverse actions (rule 4). */
export function ReasonDialog({
  open,
  title,
  hint,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  onOpenChange,
  submitError,
}: ReasonDialogProps) {
  const [localError] = useState<string | null>(null)
  const form = useForm<ReasonFormValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (open) form.reset({ reason: '' })
  }, [open, form])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form
          id="reason-form"
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => onConfirm(v.reason))}
        >
          {hint ? (
            <p className="text-muted-foreground text-sm">{hint}</p>
          ) : null}
          {submitError || localError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError ?? localError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="reason" required>
              {t.treasury.common.reason}
            </Label>
            <Input
              id="reason"
              aria-invalid={!!form.formState.errors.reason}
              {...form.register('reason')}
            />
            <FieldError message={form.formState.errors.reason?.message} />
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="reason-form"
            variant={destructive ? 'destructive' : 'default'}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
