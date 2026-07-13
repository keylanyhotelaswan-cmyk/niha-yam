import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/menu/components/FieldError'
import { useUpsertCategory } from '@/features/menu/hooks/useMenuMutations'
import {
  categorySchema,
  type CategoryFormValues,
} from '@/features/menu/schemas/menu.schemas'
import type { MenuCategory } from '@/features/menu/types'
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

type CategoryDialogProps = {
  category: MenuCategory | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CategoryDialog({
  category,
  open,
  onOpenChange,
}: CategoryDialogProps) {
  const isEdit = category !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useUpsertCategory()

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
      sortOrder: 0,
      showInPos: true,
      isActive: true,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: category?.name ?? '',
        sortOrder: category?.sort_order ?? 0,
        showInPos: category?.show_in_pos ?? true,
        isActive: category?.is_active ?? true,
      })
      setSubmitError(null)
    }
  }, [open, category, form])

  function onSubmit(values: CategoryFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        id: category?.id ?? null,
        name: values.name,
        sortOrder: values.sortOrder,
        showInPos: values.showInPos,
        isActive: values.isActive,
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit ? t.menu.categories.updated : t.menu.categories.created,
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
            {isEdit ? t.menu.categories.edit : t.menu.categories.add}
          </DialogTitle>
        </DialogHeader>

        <form
          id="category-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="cat-name" required>
              {t.menu.categories.name}
            </Label>
            <Input
              id="cat-name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-sort">{t.menu.common.sortOrder}</Label>
            <Input
              id="cat-sort"
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
            <p className="text-muted-foreground text-xs">
              {t.menu.common.sortOrderHint}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('showInPos')}
            />
            {t.menu.common.showInPos}
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
            form="category-form"
            loading={mutation.isPending}
          >
            {t.menu.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
