import { useEffect, useState } from 'react'
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
import type { PosMenuItem } from '@/features/pos/types'
import { t } from '@/shared/i18n'

type Props = {
  item: PosMenuItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (openPrice: number) => void
}

export function OpenPriceDialog({ item, open, onOpenChange, onConfirm }: Props) {
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPrice('')
      setError(null)
    }
  }, [open])

  if (!item) return null

  function submit() {
    const value = Number(price)
    if (!Number.isFinite(value) || value < 0) {
      setError(t.pos.openPrice.invalid)
      return
    }
    onConfirm(value)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="open-price">{t.pos.openPrice.label}</Label>
          <Input
            id="open-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {error ? (
            <p className="text-destructive text-xs">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={submit}>
            {t.pos.modifiers.addToCart}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
