import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useChangeStaffPassword } from '@/features/staff/hooks/useChangeStaffPassword'
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from '@/features/staff/schemas/staff.schemas'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'
import { useState } from 'react'

type ChangePasswordDialogProps = {
  staffId: string
  staffName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordDialog({
  staffId,
  staffName,
  open,
  onOpenChange,
}: ChangePasswordDialogProps) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const passwordMutation = useChangeStaffPassword()

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: '' },
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setSubmitError(null)
    }
  }

  function onSubmit(values: ChangePasswordFormValues) {
    setSubmitError(null)
    passwordMutation.mutate(
      { staffId, password: values.password },
      {
        onSuccess: () => {
          toast.success(t.staff.password.updated)
          handleOpenChange(false)
        },
        onError: (error: Error) => setSubmitError(error.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.staff.password.title}</DialogTitle>
          <DialogDescription>
            {t.staff.password.description(staffName)}
          </DialogDescription>
        </DialogHeader>

        <form
          id="change-password-form"
          className="space-y-2"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          <Label htmlFor="cp-password" required>
            {t.staff.password.value}
          </Label>
          <Input
            id="cp-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.password}
            {...form.register('password')}
          />
          {form.formState.errors.password ? (
            <p className="text-destructive text-xs">
              {form.formState.errors.password.message}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={passwordMutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="change-password-form"
            loading={passwordMutation.isPending}
          >
            {t.staff.password.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
