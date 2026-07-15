import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { RoleSelect } from '@/features/staff/components/RoleSelect'
import { DiscountPermissionsSection } from '@/features/staff/components/DiscountPermissionsSection'
import { useBranches } from '@/features/staff/hooks/useBranches'
import { useUpdateStaff } from '@/features/staff/hooks/useUpdateStaff'
import {
  editStaffSchema,
  type EditStaffFormValues,
} from '@/features/staff/schemas/staff.schemas'
import type { StaffListItem, StaffRole } from '@/features/staff/types'
import {
  DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE,
  type DiscountPermissionConfig,
} from '@/shared/access/discountPermissions'
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

type EditStaffDialogProps = {
  staff: StaffListItem
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditStaffDialog({
  staff,
  open,
  onOpenChange,
}: EditStaffDialogProps) {
  const branchesQuery = useBranches(open)
  const updateMutation = useUpdateStaff()

  const currentRole: StaffRole = staff.branches[0]?.role ?? 'cashier'

  const form = useForm<EditStaffFormValues>({
    resolver: zodResolver(editStaffSchema),
    defaultValues: { displayName: staff.display_name, role: currentRole },
  })

  const watchedRole = form.watch('role')
  const [discountPerms, setDiscountPerms] = useState<DiscountPermissionConfig>(
    DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE[currentRole],
  )

  useEffect(() => {
    setDiscountPerms(DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE[watchedRole])
  }, [watchedRole])

  // Re-seed when the target changes (dialog reused across rows).
  useEffect(() => {
    form.reset({ displayName: staff.display_name, role: currentRole })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff.id])

  function onSubmit(values: EditStaffFormValues) {
    const branchId = branchesQuery.data?.[0]?.id
    if (!branchId) {
      toast.error(t.staff.errors.generic)
      return
    }
    updateMutation.mutate(
      {
        staffId: staff.id,
        displayName: values.displayName,
        branchId,
        role: values.role,
      },
      {
        onSuccess: () => {
          toast.success(t.staff.form.updated)
          onOpenChange(false)
        },
        onError: (error: Error) => toast.error(error.message),
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.staff.form.editTitle}</DialogTitle>
          <DialogDescription>{t.staff.form.editDescription}</DialogDescription>
        </DialogHeader>

        <form
          id="edit-staff-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <div className="space-y-2">
            <Label htmlFor="es-username">{t.staff.form.username}</Label>
            <Input
              id="es-username"
              value={staff.username ?? ''}
              disabled
              readOnly
            />
            <p className="text-muted-foreground text-xs">
              {t.staff.form.usernameHint}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="es-name" required>
              {t.staff.form.name}
            </Label>
            <Input
              id="es-name"
              aria-invalid={!!errors.displayName}
              {...form.register('displayName')}
            />
            {errors.displayName ? (
              <p className="text-destructive text-xs">
                {errors.displayName.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="es-role" required>
              {t.staff.form.role}
            </Label>
            <RoleSelect
              id="es-role"
              aria-invalid={!!errors.role}
              {...form.register('role')}
            />
            {errors.role ? (
              <p className="text-destructive text-xs">{errors.role.message}</p>
            ) : null}
          </div>

          <DiscountPermissionsSection
            role={watchedRole}
            value={discountPerms}
            onChange={setDiscountPerms}
            readOnly
          />

          {branchesQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t.staff.errors.generic}</AlertDescription>
            </Alert>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={updateMutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="edit-staff-form"
            loading={updateMutation.isPending}
            disabled={branchesQuery.isLoading}
          >
            {t.staff.form.submitEdit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
