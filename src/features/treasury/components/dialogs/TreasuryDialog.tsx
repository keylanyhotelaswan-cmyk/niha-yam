import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useUpsertTreasury } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  treasurySchema,
  type TreasuryFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
import type { TreasuryRow, TreasuryType } from '@/features/treasury/types'
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
  treasury: TreasuryRow | null
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm'

const TYPES: TreasuryType[] = ['cash', 'digital', 'bank']

export function TreasuryDialog({ open, treasury, onOpenChange }: Props) {
  const isEdit = treasury !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useUpsertTreasury()

  const form = useForm<TreasuryFormValues>({
    resolver: zodResolver(treasurySchema),
    defaultValues: { name: '', type: 'cash', sortOrder: 0 },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: treasury?.name ?? '',
        type: treasury?.type ?? 'cash',
        sortOrder: treasury?.sort_order ?? 0,
      })
      setSubmitError(null)
    }
  }, [open, treasury, form])

  function onSubmit(values: TreasuryFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        id: treasury?.id ?? null,
        name: values.name,
        type: values.type,
        sortOrder: values.sortOrder,
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit
              ? t.treasury.settings.treasuryUpdated
              : t.treasury.settings.treasuryCreated,
          )
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t.treasury.settings.editTreasury
              : t.treasury.settings.addTreasury}
          </DialogTitle>
        </DialogHeader>
        <form
          id="treasury-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="tz-name" required>
              {t.treasury.settings.treasuryName}
            </Label>
            <Input
              id="tz-name"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tz-type" required>
              {t.treasury.settings.treasuryTypeLabel}
            </Label>
            <select
              id="tz-type"
              className={selectClass}
              disabled={isEdit}
              {...form.register('type')}
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t.treasury.treasuryType[ty]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tz-sort">{t.treasury.settings.sortOrder}</Label>
            <Input
              id="tz-sort"
              type="number"
              inputMode="numeric"
              min={0}
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="treasury-form"
            loading={mutation.isPending}
          >
            {t.treasury.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
