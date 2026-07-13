import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/menu/components/FieldError'
import { useUpsertModifierGroup } from '@/features/menu/hooks/useMenuMutations'
import {
  modifierGroupSchema,
  type ModifierGroupFormValues,
} from '@/features/menu/schemas/menu.schemas'
import type { ModifierGroup } from '@/features/menu/types'
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

type ModifierGroupDialogProps = {
  group: ModifierGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModifierGroupDialog({
  group,
  open,
  onOpenChange,
}: ModifierGroupDialogProps) {
  const isEdit = group !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useUpsertModifierGroup()

  const form = useForm<ModifierGroupFormValues>({
    resolver: zodResolver(modifierGroupSchema),
    defaultValues: {
      name: '',
      minSelections: 0,
      maxSelections: 1,
      sortOrder: 0,
      isActive: true,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: group?.name ?? '',
        minSelections: group?.min_selections ?? 0,
        maxSelections: group?.max_selections ?? 1,
        sortOrder: group?.sort_order ?? 0,
        isActive: group?.is_active ?? true,
      })
      setSubmitError(null)
    }
  }, [open, group, form])

  function onSubmit(values: ModifierGroupFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        id: group?.id ?? null,
        name: values.name,
        minSelections: values.minSelections,
        maxSelections: values.maxSelections,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit
              ? t.menu.modifiers.groupUpdated
              : t.menu.modifiers.groupCreated,
          )
          onOpenChange(false)
        },
        onError: (error: Error) => setSubmitError(error.message),
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t.menu.modifiers.editGroup : t.menu.modifiers.addGroup}
          </DialogTitle>
        </DialogHeader>

        <form
          id="mod-group-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="mg-name" required>
              {t.menu.modifiers.groupName}
            </Label>
            <Input
              id="mg-name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mg-min">{t.menu.modifiers.minSelections}</Label>
              <Input
                id="mg-min"
                type="number"
                inputMode="numeric"
                min={0}
                {...form.register('minSelections', { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mg-max">{t.menu.modifiers.maxSelections}</Label>
              <Input
                id="mg-max"
                type="number"
                inputMode="numeric"
                min={0}
                aria-invalid={!!errors.maxSelections}
                {...form.register('maxSelections', { valueAsNumber: true })}
              />
              <p className="text-muted-foreground text-xs">
                {t.menu.modifiers.maxSelectionsHint}
              </p>
              <FieldError message={errors.maxSelections?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mg-sort">{t.menu.common.sortOrder}</Label>
            <Input
              id="mg-sort"
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('isActive')}
            />
            {t.menu.common.active}
          </label>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="mod-group-form"
            loading={mutation.isPending}
          >
            {t.menu.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
