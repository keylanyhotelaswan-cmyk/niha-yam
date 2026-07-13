import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/treasury/components/FieldError'
import { useCreateExpense } from '@/features/treasury/hooks/useTreasuryMutations'
import {
  expenseSchema,
  type ExpenseFormValues,
} from '@/features/treasury/schemas/treasury.schemas'
import type { ExpenseCategory, TreasuryRow } from '@/features/treasury/types'
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
  treasuries: TreasuryRow[]
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm'

const CATEGORIES: ExpenseCategory[] = [
  'petty_cash',
  'supplies',
  'utilities',
  'salary',
  'rent',
  'maintenance',
  'other',
]

export function ExpenseDialog({ open, treasuries, onOpenChange }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useCreateExpense()
  const active = treasuries.filter((tr) => tr.is_active)

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      treasuryId: '',
      category: 'petty_cash',
      amount: 0,
      description: '',
      vendor: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        treasuryId: active[0]?.id ?? '',
        category: 'petty_cash',
        amount: 0,
        description: '',
        vendor: '',
      })
      setSubmitError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onSubmit(values: ExpenseFormValues) {
    setSubmitError(null)
    mutation.mutate(
      {
        treasuryId: values.treasuryId,
        category: values.category,
        amount: values.amount,
        description: values.description?.trim() || null,
        vendor: values.vendor?.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t.treasury.expenses.created)
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
          <DialogTitle>{t.treasury.expenses.title}</DialogTitle>
        </DialogHeader>
        <form
          id="expense-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="exp-treasury" required>
              {t.treasury.expenses.treasury}
            </Label>
            <select
              id="exp-treasury"
              className={selectClass}
              {...form.register('treasuryId')}
            >
              {active.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-category" required>
              {t.treasury.expenses.category}
            </Label>
            <select
              id="exp-category"
              className={selectClass}
              {...form.register('category')}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.treasury.expenseCategory[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-amount" required>
              {t.treasury.common.amount}
            </Label>
            <Input
              id="exp-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              aria-invalid={!!errors.amount}
              {...form.register('amount', { valueAsNumber: true })}
            />
            <FieldError message={errors.amount?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-desc">{t.treasury.expenses.description}</Label>
            <Input id="exp-desc" {...form.register('description')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-vendor">{t.treasury.expenses.vendor}</Label>
            <Input id="exp-vendor" {...form.register('vendor')} />
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" form="expense-form" loading={mutation.isPending}>
            {t.treasury.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
