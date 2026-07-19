import { useMemo, useState } from 'react'
import { SmartShiftSheet } from '@/features/treasury/components/SmartShiftSheet'
import { ShiftSummary } from '@/features/treasury/components/ShiftSummary'
import {
  useShiftArchive,
  useShiftsArchive,
} from '@/features/treasury/hooks/useTreasuryQueries'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import type { ShiftArchiveListItem } from '@/features/treasury/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { t } from '@/shared/i18n'

function matchesArchiveQuery(s: ShiftArchiveListItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  if (s.reference?.toLowerCase().includes(needle)) return true
  if (s.opened_by_name?.toLowerCase().includes(needle)) return true
  if (s.closed_by_name?.toLowerCase().includes(needle)) return true
  for (const h of s.handovers ?? []) {
    if (h.reference?.toLowerCase().includes(needle)) return true
    if (h.cashier_name?.toLowerCase().includes(needle)) return true
    if (h.received_by_name?.toLowerCase().includes(needle)) return true
  }
  return false
}

export function ShiftArchiveTab() {
  const list = useShiftsArchive()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const detail = useShiftArchive(selectedId)
  const rows = useMemo(
    () => (list.data ?? []).filter((s) => matchesArchiveQuery(s, query)),
    [list.data, query],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold">
          {t.treasury.handover.archiveHeading}
        </h2>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.treasury.handover.archiveSearch}
          className="sm:max-w-xs"
        />
      </div>
      {list.isLoading ? <LoadingState /> : null}
      {!list.isLoading && (list.data ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.treasury.handover.archiveEmpty}
        </p>
      ) : null}
      {!list.isLoading && (list.data ?? []).length > 0 && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.treasury.handover.archiveNoMatch}
        </p>
      ) : null}
      <div className="space-y-3">
        {rows.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base">{s.reference}</CardTitle>
              <Badge variant={s.status === 'open' ? 'info' : 'secondary'}>
                {s.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {s.opened_by_name ?? '—'} · {formatDateTime(s.opened_at)}
                {s.closed_at ? ` → ${formatDateTime(s.closed_at)}` : ''}
              </p>
              {(s.handovers ?? []).length > 0 ? (
                <ul className="space-y-2 text-xs">
                  {s.handovers.map((h) => (
                    <li key={h.id} className="rounded-lg border bg-[#f8fafc] p-2">
                      <p className="font-medium">
                        {h.reference} ·{' '}
                        {h.kind === 'to_main'
                          ? t.treasury.handover.kindToMain
                          : t.treasury.handover.kindToNext}
                      </p>
                      <p className="text-muted-foreground mt-1">
                        {t.treasury.handover.chainHandedBy}: {h.cashier_name ?? '—'}
                        {h.received_by_name
                          ? ` → ${t.treasury.handover.chainReceivedBy}: ${h.received_by_name}`
                          : ''}
                      </p>
                      <p dir="ltr" className="mt-0.5 font-semibold">
                        {formatMoney(Number(h.amount))}
                        {h.kind === 'to_next_shift' &&
                        h.receiver_starting_trust != null
                          ? ` → ${formatMoney(Number(h.receiver_starting_trust))}`
                          : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setSelectedId(s.id)}>
                {t.treasury.handover.archiveOpen}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={selectedId !== null}
        onOpenChange={(next) => !next && setSelectedId(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.treasury.handover.archiveHeading}</DialogTitle>
          </DialogHeader>
          {detail.isLoading ? <LoadingState /> : null}
          {detail.data ? (
            <div className="space-y-6 text-sm">
              {selectedId ? <SmartShiftSheet shiftId={selectedId} /> : null}
              {detail.data.report ? (
                <ShiftSummary report={detail.data.report} showApprovalMetrics />
              ) : null}
              <div>
                <p className="mb-2 font-semibold">
                  {t.treasury.handover.archiveHandovers}
                </p>
                {(detail.data.handovers ?? []).length === 0 ? (
                  <p className="text-muted-foreground">{t.treasury.common.none}</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.data.handovers.map((h) => (
                      <li key={h.id} className="space-y-2 rounded-lg border p-3">
                        <p className="font-medium">
                          {h.reference} ·{' '}
                          {h.kind === 'to_main'
                            ? t.treasury.handover.kindToMain
                            : t.treasury.handover.kindToNext}{' '}
                          · {h.status}
                        </p>
                        <div className="space-y-1 text-sm">
                          <ChainRow
                            label={t.treasury.handover.chainHandedBy}
                            value={h.cashier_name ?? '—'}
                          />
                          <ChainRow
                            label={t.treasury.handover.chainReceivedBy}
                            value={h.received_by_name ?? '—'}
                          />
                          <ChainRow
                            label={t.treasury.handover.chainAmount}
                            value={formatMoney(Number(h.amount))}
                            ltr
                          />
                          {h.kind === 'to_next_shift' &&
                          h.status === 'executed' ? (
                            <>
                              <ChainRow
                                label={t.treasury.handover.chainStartingTrust}
                                value={formatMoney(
                                  Number(
                                    h.receiver_starting_trust ?? h.amount,
                                  ),
                                )}
                                ltr
                              />
                              {h.target_shift_reference ? (
                                <ChainRow
                                  label={t.treasury.handover.chainTargetShift}
                                  value={h.target_shift_reference}
                                  ltr
                                />
                              ) : null}
                            </>
                          ) : null}
                          {Math.abs(Number(h.source_variance ?? 0)) > 0.001 ? (
                            <ChainRow
                              label={t.treasury.handover.chainVariance}
                              value={formatMoney(Number(h.source_variance))}
                              ltr
                              warn
                            />
                          ) : null}
                          {h.received_actual_cash != null ? (
                            <ChainRow
                              label={t.treasury.handover.chainReceivedCount}
                              value={formatMoney(Number(h.received_actual_cash))}
                              ltr
                            />
                          ) : null}
                          {Math.abs(Number(h.receive_variance ?? 0)) > 0.001 ? (
                            <ChainRow
                              label={t.treasury.handover.chainReceiveVariance}
                              value={formatMoney(Number(h.receive_variance))}
                              ltr
                              warn
                            />
                          ) : null}
                        </div>
                        {h.rejection_reason ? (
                          <p className="text-destructive text-xs">
                            {t.treasury.handover.rejectedReason}:{' '}
                            {h.rejection_reason}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-2 font-semibold">
                  {t.treasury.handover.archiveOrders}
                </p>
                {(detail.data.orders ?? []).length === 0 ? (
                  <p className="text-muted-foreground">{t.treasury.common.none}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {detail.data.orders.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span>
                          #{o.order_number} · {o.payment_status}
                        </span>
                        <span dir="ltr">{formatMoney(Number(o.total))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ChainRow({
  label,
  value,
  ltr,
  warn,
}: {
  label: string
  value: string
  ltr?: boolean
  warn?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={warn ? 'font-semibold text-amber-700' : 'font-semibold'}
        dir={ltr ? 'ltr' : undefined}
      >
        {value}
      </span>
    </div>
  )
}
