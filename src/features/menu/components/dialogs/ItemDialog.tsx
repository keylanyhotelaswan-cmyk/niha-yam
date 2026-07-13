import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/menu/components/FieldError'
import { useUpsertItem } from '@/features/menu/hooks/useMenuMutations'
import {
  itemSchema,
  type ItemFormValues,
} from '@/features/menu/schemas/menu.schemas'
import type {
  MenuCategory,
  MenuItem,
  ModifierGroup,
} from '@/features/menu/types'
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

type ItemDialogProps = {
  item: MenuItem | null
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ItemDialog({
  item,
  categories,
  modifierGroups,
  open,
  onOpenChange,
}: ItemDialogProps) {
  const isEdit = item !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const mutation = useUpsertItem()

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: '',
      categoryId: null,
      sku: '',
      basePrice: 0,
      sortOrder: 0,
      showInPos: true,
      needsKitchen: true,
      needsPrint: true,
      acceptsModifiers: false,
      allowsDiscounts: true,
      isOpenPrice: false,
      isFavorite: false,
      description: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: item?.name ?? '',
        categoryId: item?.category_id ?? null,
        sku: item?.sku ?? '',
        basePrice: item?.base_price ?? 0,
        sortOrder: item?.sort_order ?? 0,
        showInPos: item?.show_in_pos ?? true,
        needsKitchen: item?.needs_kitchen ?? true,
        needsPrint: item?.needs_print ?? true,
        acceptsModifiers: item?.accepts_modifiers ?? false,
        allowsDiscounts: item?.allows_discounts ?? true,
        isOpenPrice: item?.is_open_price ?? false,
        isFavorite: item?.is_favorite ?? false,
        description: item?.description ?? '',
      })
      setSelectedGroups(item?.modifier_group_ids ?? [])
      setSubmitError(null)
    }
  }, [open, item, form])

  const acceptsModifiers = form.watch('acceptsModifiers')

  function toggleGroup(id: string) {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    )
  }

  function onSubmit(values: ItemFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        id: item?.id ?? null,
        categoryId: values.categoryId,
        name: values.name,
        sku: values.sku && values.sku.length > 0 ? values.sku : null,
        basePrice: values.basePrice,
        sortOrder: values.sortOrder,
        showInPos: values.showInPos,
        needsKitchen: values.needsKitchen,
        needsPrint: values.needsPrint,
        acceptsModifiers: values.acceptsModifiers,
        allowsDiscounts: values.allowsDiscounts,
        isOpenPrice: values.isOpenPrice,
        isFavorite: values.isFavorite,
        description:
          values.description && values.description.length > 0
            ? values.description
            : null,
        modifierGroupIds: values.acceptsModifiers ? selectedGroups : [],
      },
      {
        onSuccess: () => {
          toast.success(isEdit ? t.menu.items.updated : t.menu.items.created)
          onOpenChange(false)
        },
        onError: (error: Error) => setSubmitError(error.message),
      },
    )
  }

  const errors = form.formState.errors
  const activeGroups = modifierGroups.filter(
    (g) => g.is_active || selectedGroups.includes(g.id),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t.menu.items.edit : t.menu.items.add}
          </DialogTitle>
        </DialogHeader>

        <form
          id="item-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="item-name" required>
              {t.menu.items.name}
            </Label>
            <Input
              id="item-name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item-category">{t.menu.items.category}</Label>
              <select
                id="item-category"
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm"
                aria-invalid={!!errors.categoryId}
                {...form.register('categoryId', {
                  setValueAs: (v) => (v === '' ? null : v),
                })}
              >
                <option value="">{t.menu.categories.uncategorized}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <FieldError message={errors.categoryId?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-price">{t.menu.items.basePrice}</Label>
              <Input
                id="item-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                aria-invalid={!!errors.basePrice}
                {...form.register('basePrice', { valueAsNumber: true })}
              />
              <FieldError message={errors.basePrice?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="item-sku">{t.menu.items.sku}</Label>
              <Input
                id="item-sku"
                autoComplete="off"
                aria-invalid={!!errors.sku}
                {...form.register('sku')}
              />
              <p className="text-muted-foreground text-xs">
                {t.menu.items.skuHint}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-sort">{t.menu.common.sortOrder}</Label>
              <Input
                id="item-sort"
                type="number"
                inputMode="numeric"
                min={0}
                {...form.register('sortOrder', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="item-desc">{t.menu.items.description}</Label>
            <Input id="item-desc" {...form.register('description')} />
          </div>

          <fieldset className="grid grid-cols-2 gap-2 rounded-md border p-3">
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
                {...form.register('isFavorite')}
              />
              {t.menu.items.isFavorite}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...form.register('needsKitchen')}
              />
              {t.menu.items.needsKitchen}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...form.register('needsPrint')}
              />
              {t.menu.items.needsPrint}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...form.register('allowsDiscounts')}
              />
              {t.menu.items.allowsDiscounts}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...form.register('isOpenPrice')}
              />
              {t.menu.items.isOpenPrice}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                {...form.register('acceptsModifiers')}
              />
              {t.menu.items.acceptsModifiers}
            </label>
          </fieldset>

          {acceptsModifiers ? (
            <div className="space-y-2">
              <Label>{t.menu.items.modifiersGroups}</Label>
              <p className="text-muted-foreground text-xs">
                {t.menu.items.modifiersGroupsHint}
              </p>
              {activeGroups.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t.menu.modifiers.empty}
                </p>
              ) : (
                <div className="space-y-1 rounded-md border p-3">
                  {activeGroups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selectedGroups.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.common.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" form="item-form" loading={mutation.isPending}>
            {t.menu.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
