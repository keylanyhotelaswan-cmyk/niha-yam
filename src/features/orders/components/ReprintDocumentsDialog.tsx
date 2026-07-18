import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { reprintOrder } from '@/features/orders/api/orders.api'
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
import { t } from '@/shared/i18n'

export type ReprintDocumentChoice = 'receipt' | 'kitchen' | 'both'

/** Server still requires a non-empty reason — cashiers no longer type it. */
const DEFAULT_REPRINT_REASON = 'إعادة طباعة من نقطة البيع'

type Props = {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}

export function ReprintDocumentsDialog({
  orderId,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const [choice, setChoice] = useState<ReprintDocumentChoice>('receipt')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setChoice('receipt')
    setError(null)
    setPending(false)
  }, [open])

  async function submit() {
    if (!orderId) return
    setPending(true)
    setError(null)
    try {
      const kinds: Array<'receipt' | 'kitchen'> =
        choice === 'both' ? ['receipt', 'kitchen'] : [choice]
      for (const kind of kinds) {
        await reprintOrder(orderId, DEFAULT_REPRINT_REASON, kind)
      }
      toast.success(t.orders.hub.reprintDone)
      onOpenChange(false)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.orders.errors.generic)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.orders.hub.reprintTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t.orders.hub.reprintHint}
          </p>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t.orders.hub.reprintDocument}
            </legend>
            {(
              [
                ['receipt', t.orders.hub.reprintReceipt],
                ['kitchen', t.orders.hub.reprintKitchen],
                ['both', t.orders.hub.reprintBoth],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="reprint-doc"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.print.common.cancel}
            </Button>
          </DialogClose>
          <Button type="button" loading={pending} onClick={() => void submit()}>
            {t.orders.hub.reprintConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
