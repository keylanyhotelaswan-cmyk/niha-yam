import { useState } from 'react'
import {
  useLiquiditySnapshot,
  useReleaseReserved,
  useUpsertLiquiditySettings,
} from '@/features/treasury/hooks/useLiquidityQueries'
import { formatMoney } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'
import { toast } from 'sonner'

export function LiquidityPanel() {
  const snap = useLiquiditySnapshot()
  const upsert = useUpsertLiquiditySettings()
  const release = useReleaseReserved()
  const data = snap.data

  const [opPct, setOpPct] = useState('')
  const [resPct, setResPct] = useState('')
  const [releaseAmt, setReleaseAmt] = useState('')
  const [releaseReason, setReleaseReason] = useState('')

  if (snap.isLoading) return null
  if (!data) return null

  const opDisplay = opPct || String(data.operating_pct)
  const resDisplay = resPct || String(data.reserved_pct)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.treasury.liquidity.heading}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {t.treasury.liquidity.subtitle}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label={t.treasury.liquidity.mainBalance}
            value={formatMoney(data.main_balance)}
          />
          <Metric
            label={t.treasury.liquidity.operating}
            value={formatMoney(data.operating_balance)}
            emphasize
          />
          <Metric
            label={t.treasury.liquidity.reserved}
            value={formatMoney(data.reserved_balance)}
          />
        </div>
        <p className="text-muted-foreground text-xs">{data.note_ar}</p>

        <div className="border-border grid gap-3 rounded border p-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t.treasury.liquidity.operatingPct}</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={opDisplay}
              onChange={(e) => {
                setOpPct(e.target.value)
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setResPct(String(100 - n))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t.treasury.liquidity.reservedPct}</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={resDisplay}
              onChange={(e) => {
                setResPct(e.target.value)
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setOpPct(String(100 - n))
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={upsert.isPending}
              onClick={() => {
                const op = Number(opDisplay)
                const rs = Number(resDisplay)
                if (!Number.isFinite(op) || !Number.isFinite(rs) || op + rs !== 100) {
                  toast.error(t.treasury.errors.INVALID_AMOUNT)
                  return
                }
                upsert.mutate(
                  { operating_pct: op, reserved_pct: rs },
                  {
                    onSuccess: () => {
                      toast.success(t.treasury.liquidity.settingsSaved)
                      setOpPct('')
                      setResPct('')
                    },
                    onError: (e) =>
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : t.treasury.errors.generic,
                      ),
                  },
                )
              }}
            >
              {t.treasury.liquidity.saveSettings}
            </Button>
          </div>
        </div>

        <div className="border-border grid gap-3 rounded border p-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t.treasury.liquidity.releaseAmount}</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={releaseAmt}
              onChange={(e) => setReleaseAmt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label>{t.treasury.liquidity.releaseReason}</Label>
            <Input
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder={t.treasury.liquidity.releaseReasonHint}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              disabled={release.isPending}
              onClick={() => {
                const amount = Number(releaseAmt)
                if (!Number.isFinite(amount) || amount <= 0) {
                  toast.error(t.treasury.errors.INVALID_AMOUNT)
                  return
                }
                if (!releaseReason.trim()) {
                  toast.error(t.treasury.errors.REASON_REQUIRED)
                  return
                }
                release.mutate(
                  { amount, reason: releaseReason.trim() },
                  {
                    onSuccess: () => {
                      toast.success(t.treasury.liquidity.released)
                      setReleaseAmt('')
                      setReleaseReason('')
                    },
                    onError: (e) =>
                      toast.error(
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
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({
  label,
  value,
  emphasize,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={emphasize ? 'text-lg font-semibold' : 'text-lg font-medium'}>
        {value} {t.treasury.currency}
      </p>
    </div>
  )
}
