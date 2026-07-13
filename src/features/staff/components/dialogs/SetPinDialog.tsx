import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useSetStaffPin } from '@/features/staff/hooks/useSetStaffPin'
import {
  setPinSchema,
  type SetPinFormValues,
} from '@/features/staff/schemas/staff.schemas'
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

type SetPinDialogProps = {
  staffId: string
  staffName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SetPinDialog({
  staffId,
  staffName,
  open,
  onOpenChange,
}: SetPinDialogProps) {
  const pinMutation = useSetStaffPin()

  const form = useForm<SetPinFormValues>({
    resolver: zodResolver(setPinSchema),
    defaultValues: { pin: '' },
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) form.reset()
  }

  function onSubmit(values: SetPinFormValues) {
    pinMutation.mutate(
      { staffId, pin: values.pin },
      {
        onSuccess: () => {
          toast.success(t.staff.pin.updated)
          handleOpenChange(false)
        },
        onError: (error: Error) => toast.error(error.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.staff.pin.title}</DialogTitle>
          <DialogDescription>
            {t.staff.pin.description(staffName)}
          </DialogDescription>
        </DialogHeader>

        <form
          id="set-pin-form"
          className="space-y-2"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <Label htmlFor="pin-value" required>
            {t.staff.pin.value}
          </Label>
          <Input
            id="pin-value"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={!!form.formState.errors.pin}
            {...form.register('pin')}
          />
          {form.formState.errors.pin ? (
            <p className="text-destructive text-xs">
              {form.formState.errors.pin.message}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pinMutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="set-pin-form"
            loading={pinMutation.isPending}
          >
            {t.staff.pin.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
