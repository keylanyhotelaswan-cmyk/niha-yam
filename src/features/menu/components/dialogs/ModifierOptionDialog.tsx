import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/menu/components/FieldError'
import { useUpsertModifierOption } from '@/features/menu/hooks/useMenuMutations'
import {
  modifierOptionSchema,
  type ModifierOptionFormValues,
} from '@/features/menu/schemas/menu.schemas'
import type { ModifierOption } from '@/features/menu/types'
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

type ModifierOptionDialogProps = {
  groupId: string
  option: ModifierOption | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ModifierOptionDialog({
  groupId,
  option,
  open,
  onOpenChange,
}: ModifierOptionDialogProps) {
  const isEdit = option !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useUpsertModifierOption()

  const form = useForm<ModifierOptionFormValues>({
    resolver: zodResolver(modifierOptionSchema),
    defaultValues: {
      name: '',
      priceDelta: 0,
      sortOrder: 0,
      isDefault: false,
      isActive: true,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: option?.name ?? '',
        priceDelta: option?.price_delta ?? 0,
        sortOrder: option?.sort_order ?? 0,
        isDefault: option?.is_default ?? false,
        isActive: option?.is_active ?? true,
      })
      setSubmitError(null)
    }
  }, [open, option, form])

  function onSubmit(values: ModifierOptionFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        id: option?.id ?? null,
        groupId,
        name: values.name,
        priceDelta: values.priceDelta,
        sortOrder: values.sortOrder,
        isDefault: values.isDefault,
        isActive: values.isActive,
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit
              ? t.menu.modifiers.optionUpdated
              : t.menu.modifiers.optionCreated,
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
            {isEdit ? t.menu.modifiers.editOption : t.menu.modifiers.addOption}
          </DialogTitle>
        </DialogHeader>

        <form
          id="mod-option-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="mo-name" required>
              {t.menu.modifiers.optionName}
            </Label>
            <Input
              id="mo-name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mo-price">{t.menu.modifiers.priceDelta}</Label>
              <Input
                id="mo-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                {...form.register('priceDelta', { valueAsNumber: true })}
              />
              <p className="text-muted-foreground text-xs">
                {t.menu.modifiers.priceDeltaHint}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mo-sort">{t.menu.common.sortOrder}</Label>
              <Input
                id="mo-sort"
                type="number"
                inputMode="numeric"
                min={0}
                {...form.register('sortOrder', { valueAsNumber: true })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('isDefault')}
            />
            {t.menu.modifiers.isDefault}
          </label>

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
            form="mod-option-form"
            loading={mutation.isPending}
          >
            {t.menu.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
