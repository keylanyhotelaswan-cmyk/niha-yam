import { useEffect, useState } from 'react'
import { useLiquiditySnapshot, useReleaseReserved } from '@/features/treasury/hooks/useLiquidityQueries'
import { formatMoney } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Suggested amount to cover the shortfall (optional). */
  suggestedAmount?: number | null
  onReleased?: () => void
}

export function isInsufficientOperatingError(message: string | null | undefined) {
  if (!message) return false
  return (
    message.includes('INSUFFICIENT_OPERATING_FUNDS') ||
    message.includes(t.treasury.errors.INSUFFICIENT_OPERATING_FUNDS)
  )
}

export function ReleaseReservedDialog({
  open,
  onOpenChange,
  suggestedAmount,
  onReleased,
}: Props) {
  const snap = useLiquiditySnapshot()
  const release = useReleaseReserved()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setReason('')
    const reserved = Number(snap.data?.reserved_balance ?? 0)
    const suggest = Number(suggestedAmount ?? 0)
    if (suggest > 0 && reserved > 0) {
      setAmount(String(Math.min(suggest, reserved)))
    } else if (reserved > 0) {
      setAmount(String(Math.min(reserved, 100)))
    } else {
      setAmount('')
    }
  }, [open, suggestedAmount, snap.data?.reserved_balance])

  const reserved = Number(snap.data?.reserved_balance ?? 0)
  const operating = Number(snap.data?.operating_balance ?? 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.treasury.liquidity.releaseDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {t.treasury.liquidity.releaseDialogBody}
          </p>
          <div className="grid grid-cols-2 gap-2 rounded border px-3 py-2">
            <div>
              <p className="text-muted-foreground text-xs">
                {t.treasury.liquidity.operating}
              </p>
              <p className="font-medium" dir="ltr">
                {formatMoney(operating)} {t.treasury.currency}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                {t.treasury.liquidity.reserved}
              </p>
              <p className="font-medium" dir="ltr">
                {formatMoney(reserved)} {t.treasury.currency}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t.treasury.liquidity.releaseAmount}</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t.treasury.liquidity.releaseReason}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.treasury.liquidity.releaseReasonHint}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.treasury.common.cancel}
          </Button>
          <Button
            disabled={release.isPending || reserved <= 0}
            onClick={() => {
              const value = Number(amount)
              if (!Number.isFinite(value) || value <= 0) {
                setError(t.treasury.errors.INVALID_AMOUNT)
                return
              }
              if (!reason.trim()) {
                setError(t.treasury.errors.REASON_REQUIRED)
                return
              }
              if (value > reserved) {
                setError(t.treasury.errors.INSUFFICIENT_RESERVED)
                return
              }
              setError(null)
              release.mutate(
                { amount: value, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(t.treasury.liquidity.released)
                    onOpenChange(false)
                    onReleased?.()
                  },
                  onError: (e) =>
                    setError(
                      e instanceof Error
                        ? e.message
                        : t.treasury.errors.generic,
                    ),
                },
              )
            }}
          >
            {t.treasury.liquidity.releaseAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
