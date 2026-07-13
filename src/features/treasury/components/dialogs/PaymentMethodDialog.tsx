import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useSetPaymentMethodMapping } from '@/features/treasury/hooks/useTreasuryMutations'
import type {
  PaymentMethodRow,
  TreasuryRow,
} from '@/features/treasury/types'
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
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  method: PaymentMethodRow
  treasuries: TreasuryRow[]
  onOpenChange: (open: boolean) => void
}

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm'

const UNLINKED = ''

export function PaymentMethodDialog({
  open,
  method,
  treasuries,
  onOpenChange,
}: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [value, setValue] = useState<string>(method.treasury_id ?? UNLINKED)
  const mutation = useSetPaymentMethodMapping()
  const active = treasuries.filter((tr) => tr.is_active)

  useEffect(() => {
    if (open) {
      setValue(method.treasury_id ?? UNLINKED)
      setSubmitError(null)
    }
  }, [open, method])

  function onSave() {
    setSubmitError(null)
    mutation.mutate(
      { id: method.id, treasuryId: value === UNLINKED ? null : value },
      {
        onSuccess: () => {
          toast.success(t.treasury.settings.mappingChanged)
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.treasury.settings.mappingTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-sm">
            {t.treasury.settings.methodName}: <strong>{method.name}</strong>
          </p>
          <div className="space-y-2">
            <Label htmlFor="pm-treasury">
              {t.treasury.settings.mappedTreasury}
            </Label>
            <select
              id="pm-treasury"
              className={selectClass}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value={UNLINKED}>{t.treasury.settings.unlinked}</option>
              {active.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              {t.treasury.common.cancel}
            </Button>
          </DialogClose>
          <Button onClick={onSave} loading={mutation.isPending}>
            {t.treasury.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
