import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { formatMoney, formatDateTime } from '@/features/treasury/utils/format'
import type { PosOperationalTreasury } from '@/features/pos/types'
import {
  shouldResetTransferForm,
  transferableAmount,
} from '@/features/pos/utils/transferable'
import {
  resolveTransferReason,
  TRANSFER_REASON_PRESETS,
  type TransferReasonPreset,
} from '@/features/pos/utils/saleMoney'
import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  treasuries: PosOperationalTreasury[]
  shiftId?: string | null
}

type TransferLogRow = {
  id: string
  amount: number
  reason: string | null
  created_at: string
  source_name: string
  dest_name: string
  user_name: string
}

export function PosTransferDialog({
  open,
  onOpenChange,
  treasuries,
  shiftId,
}: Props) {
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [amount, setAmount] = useState('')
  const [reasonPreset, setReasonPreset] = useState<TransferReasonPreset | ''>('')
  const [reasonOther, setReasonOther] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wasOpenRef = useRef(false)

  const drawer = useMemo(
    () => treasuries.find((row) => row.code === 'drawer'),
    [treasuries],
  )
  const digitals = useMemo(
    () => treasuries.filter((row) => row.code !== 'drawer'),
    [treasuries],
  )

  const logQuery = useQuery({
    queryKey: ['pos', 'transfer-log', shiftId],
    enabled: open && Boolean(shiftId),
    queryFn: async (): Promise<TransferLogRow[]> => {
      const { data, error: qErr } = await supabase
        .from('treasury_transfers')
        .select(
          'id, amount, reason, created_at, source_treasury_id, dest_treasury_id, created_by',
        )
        .eq('shift_id', shiftId!)
        .eq('auto_approved', true)
        .order('created_at', { ascending: false })
        .limit(20)
      if (qErr) throw qErr
      const rows = data ?? []
      const staffIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))]
      const treasuryIds = [
        ...new Set(
          rows.flatMap((r) => [r.source_treasury_id, r.dest_treasury_id]),
        ),
      ]
      const [{ data: staff }, { data: tres }] = await Promise.all([
        staffIds.length
          ? supabase.from('staff').select('id, display_name').in('id', staffIds)
          : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
        treasuryIds.length
          ? supabase.from('treasuries').select('id, name').in('id', treasuryIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      ])
      const staffMap = new Map((staff ?? []).map((s) => [s.id, s.display_name]))
      const tresMap = new Map((tres ?? []).map((x) => [x.id, x.name]))
      return rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        reason: r.reason,
        created_at: r.created_at,
        source_name: tresMap.get(r.source_treasury_id) ?? '—',
        dest_name: tresMap.get(r.dest_treasury_id) ?? '—',
        user_name: (r.created_by && staffMap.get(r.created_by)) || '—',
      }))
    },
  })

  useEffect(() => {
    if (shouldResetTransferForm(wasOpenRef.current, open)) {
      setSourceId(drawer?.id ?? '')
      setDestId(digitals[0]?.id ?? '')
      setAmount('')
      setReasonPreset('')
      setReasonOther('')
      setError(null)
    } else if (open) {
      if (!sourceId && drawer?.id) setSourceId(drawer.id)
      if (!destId && digitals[0]?.id) setDestId(digitals[0].id)
    }
    wasOpenRef.current = open
  }, [open, drawer?.id, digitals, sourceId, destId])

  const source = treasuries.find((tr) => tr.id === sourceId)
  const sourceAvailable = transferableAmount(source)

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
    if (!reasonPreset) {
      setError(t.pos.ops.reasonRequired)
      return
    }
    const reason = resolveTransferReason(
      reasonPreset,
      reasonOther,
      t.pos.ops.reasonPresets,
    )
    if (!reason) {
      setError(
        reasonPreset === 'other'
          ? t.pos.ops.reasonOtherRequired
          : t.pos.ops.reasonRequired,
      )
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
        reason,
      })
      toast.success(t.pos.ops.transferDone)
      void logQuery.refetch()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
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
                  {tr.name} ({formatMoney(transferableAmount(tr))})
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
                  {tr.name} ({formatMoney(transferableAmount(tr))})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.amount}</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {source ? (
              <p className="text-muted-foreground text-xs">
                {source.code === 'drawer' ? t.pos.ops.drawerBalance : t.pos.ops.available}
                : {formatMoney(sourceAvailable)}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>{t.pos.ops.reason}</Label>
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={reasonPreset}
              onChange={(e) =>
                setReasonPreset(e.target.value as TransferReasonPreset | '')
              }
            >
              <option value="">{'— اختر السبب —'}</option>
              {TRANSFER_REASON_PRESETS.map((key) => (
                <option key={key} value={key}>
                  {t.pos.ops.reasonPresets[key]}
                </option>
              ))}
            </select>
            {reasonPreset === 'other' ? (
              <Input
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
                placeholder={t.pos.ops.reasonOtherRequired}
              />
            ) : null}
          </div>

          {shiftId ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">{t.pos.ops.recentTransfers}</p>
              {logQuery.isLoading ? (
                <p className="text-muted-foreground text-xs">{t.common.loading}</p>
              ) : (logQuery.data?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-xs">{t.pos.ops.noTransfers}</p>
              ) : (
                <ul className="max-h-40 space-y-2 overflow-y-auto text-xs">
                  {(logQuery.data ?? []).map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2"
                    >
                      <div className="font-semibold text-[#0f172a]">
                        {row.source_name} → {row.dest_name} ·{' '}
                        <span dir="ltr">{formatMoney(row.amount)}</span>
                      </div>
                      <div className="text-[#64748b]">
                        {row.reason || '—'} · {row.user_name} ·{' '}
                        {formatDateTime(row.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
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
