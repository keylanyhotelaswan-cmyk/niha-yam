import { useEffect, useMemo, useState } from 'react'
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
import { posOperationalTransfer } from '@/features/pos/api/pos.api'
import { formatMoney } from '@/features/treasury/utils/format'
import type { PosOperationalTreasury } from '@/features/pos/types'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  treasuries: PosOperationalTreasury[]
}

/** Matches server: least(approved ledger, operational), never negative. */
function transferableOf(tr: PosOperationalTreasury | undefined): number {
  if (!tr) return 0
  const operational = Number(tr.balance ?? 0)
  const approved =
    tr.approved_balance != null ? Number(tr.approved_balance) : operational
  return Math.max(0, Math.min(operational, approved))
}

export function PosTransferDialog({ open, onOpenChange, treasuries }: Props) {
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drawer = treasuries.find((row) => row.code === 'drawer')
  const digitals = treasuries.filter((row) => row.code !== 'drawer')

  useEffect(() => {
    if (open) {
      setSourceId(drawer?.id ?? '')
      setDestId(digitals[0]?.id ?? '')
      setAmount('')
      setReason('')
      setError(null)
    }
  }, [open, drawer?.id, digitals])

  const source = treasuries.find((tr) => tr.id === sourceId)
  const sourceAvailable = transferableOf(source)

  const destOptions = useMemo(() => {
    if (!source) return treasuries
    if (source.code === 'drawer') return digitals
    return drawer ? [drawer] : []
  }, [source, treasuries, digitals, drawer])

  async function submit() {
    setError(null)
    const value = Number(amount)
    if (!sourceId || !destId || !Number.isFinite(value) || value <= 0) {
      setError(t.pos.ops.invalidAmount)
      return
    }
    if (value > sourceAvailable + 1e-9) {
      setError(t.pos.errors.INSUFFICIENT_FUNDS)
      return
    }
    setSubmitting(true)
    try {
      await posOperationalTransfer({
        sourceTreasuryId: sourceId,
        destTreasuryId: destId,
        amount: value,
        reason: reason || null,
      })
      toast.success(t.pos.ops.transferDone)
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
          <DialogTitle>{t.pos.ops.transfer}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label>{t.pos.ops.from}</Label>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value)
                const nextSource = treasuries.find((tr) => tr.id === e.target.value)
                if (nextSource?.code === 'drawer') {
                  setDestId(digitals[0]?.id ?? '')
                } else if (drawer) {
                  setDestId(drawer.id)
                }
              }}
            >
              {treasuries.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name} ({formatMoney(transferableOf(tr))})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.to}</Label>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
            >
              {destOptions.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name} ({formatMoney(transferableOf(tr))})
                </option>
              ))}
            </select>
          </div>
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
            {source ? (
              <p className="text-muted-foreground text-xs">
                {t.pos.ops.available}: {formatMoney(sourceAvailable)}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.reason}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
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
