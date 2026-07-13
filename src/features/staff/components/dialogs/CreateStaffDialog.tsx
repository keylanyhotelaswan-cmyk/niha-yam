import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { RoleSelect } from '@/features/staff/components/RoleSelect'
import { useCreateStaff } from '@/features/staff/hooks/useCreateStaff'
import {
  createStaffSchema,
  type CreateStaffFormValues,
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
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-destructive text-xs">{message}</p>
}

export function CreateStaffDialog() {
  const [open, setOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const createMutation = useCreateStaff()

  const form = useForm<CreateStaffFormValues>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: {
      displayName: '',
      username: '',
      password: '',
      pin: '',
      role: 'cashier',
      isActive: true,
    },
  })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset()
      setSubmitError(null)
    }
  }

  function onSubmit(values: CreateStaffFormValues) {
    setSubmitError(null)
    createMutation.mutate(
      {
        username: values.username,
        displayName: values.displayName,
        password: values.password,
        pin: values.pin || null,
        role: values.role,
        isActive: values.isActive,
      },
      {
        onSuccess: () => {
          toast.success(t.staff.form.created)
          handleOpenChange(false)
        },
        onError: (error: Error) => setSubmitError(error.message),
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>{t.staff.actions.create}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.staff.form.createTitle}</DialogTitle>
          <DialogDescription>
            {t.staff.form.createDescription}
          </DialogDescription>
        </DialogHeader>

        <form
          id="create-staff-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="cs-name" required>
              {t.staff.form.name}
            </Label>
            <Input
              id="cs-name"
              aria-invalid={!!errors.displayName}
              {...form.register('displayName')}
            />
            <FieldError message={errors.displayName?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-username" required>
              {t.staff.form.username}
            </Label>
            <Input
              id="cs-username"
              autoComplete="off"
              aria-invalid={!!errors.username}
              {...form.register('username')}
            />
            <p className="text-muted-foreground text-xs">
              {t.staff.form.usernameHint}
            </p>
            <FieldError message={errors.username?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-password" required>
              {t.staff.form.password}
            </Label>
            <Input
              id="cs-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...form.register('password')}
            />
            <FieldError message={errors.password?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-pin">{t.staff.form.pin}</Label>
            <Input
              id="cs-pin"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={!!errors.pin}
              {...form.register('pin')}
            />
            <FieldError message={errors.pin?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-role" required>
              {t.staff.form.role}
            </Label>
            <RoleSelect
              id="cs-role"
              aria-invalid={!!errors.role}
              {...form.register('role')}
            />
            <FieldError message={errors.role?.message} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('isActive')}
            />
            {t.staff.form.status}: {t.staff.status.active}
          </label>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={createMutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="create-staff-form"
            loading={createMutation.isPending}
          >
            {t.staff.form.submitCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
