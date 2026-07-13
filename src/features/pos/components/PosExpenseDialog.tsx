import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { posRecordExpense } from '@/features/pos/api/pos.api'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PosExpenseDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [vendor, setVendor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAmount('')
      setDescription('')
      setVendor('')
      setError(null)
    }
  }, [open])

  async function submit() {
    setError(null)
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError(t.pos.ops.invalidAmount)
      return
    }
    setSubmitting(true)
    try {
      await posRecordExpense({
        amount: value,
        category: 'petty_cash',
        description: description || null,
        vendor: vendor || null,
      })
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
      void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
      toast.success(t.pos.ops.expenseDone)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.pos.ops.expense}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label>{t.pos.ops.amount}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.description}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.vendor}</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button type="button" loading={submitting} onClick={() => void submit()}>
            {t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
