import {
  DateRangeFields,
  KpiCard,
  Money,
  ModeBadge,
  orderTypeLabel,
} from '@/features/reports/components/ReportChrome'
import {
  useDeliveryByDriver,
  useExpensesReport,
  useItemMix,
  useOfficialSales,
  useOrdersSummary,
  usePrintReliability,
  useShiftReport,
  useShiftsForReports,
  useTodaySummary,
  useTreasuryLedgerReport,
} from '@/features/reports/hooks/useReportsQueries'
import {
  cairoToday,
  downloadCsv,
  printReportNode,
} from '@/features/reports/utils/report-export'
import { useBalances } from '@/features/treasury/hooks/useTreasuryQueries'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'
import { useMemo, useState, type ReactNode } from 'react'

const TABS = [
  'today',
  'shift',
  'sales',
  'treasury',
  'expenses',
  'orders',
  'delivery',
  'items',
  'print',
] as const
type Tab = (typeof TABS)[number]

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('today')
  const today = cairoToday()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const range = useMemo(() => ({ from, to }), [from, to])

  return (
    <div className="space-y-6 print:space-y-3">
      <PageHeader
        title={t.reports.title}
        description={t.reports.subtitle}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              type="button"
              variant="outline"
              onClick={() => printReportNode(t.reports.title)}
            >
              {t.reports.export.print}
            </Button>
          </div>
        }
      />

      <div
        role="tablist"
        className="border-border flex flex-wrap gap-1 border-b print:hidden"
      >
        {TABS.map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant="ghost"
            className={cn(
              'rounded-none border-b-2 border-transparent',
              tab === value && 'border-primary text-primary',
            )}
            onClick={() => setTab(value)}
          >
            {t.reports.tabs[value]}
          </Button>
        ))}
      </div>

      {tab !== 'today' ? (
        <div className="print:hidden">
          <DateRangeFields
            from={from}
            to={to}
            onFrom={setFrom}
            onTo={setTo}
          />
        </div>
      ) : null}

      {tab === 'today' ? <TodayTab onGo={setTab} /> : null}
      {tab === 'shift' ? <ShiftTab range={range} /> : null}
      {tab === 'sales' ? <SalesTab range={range} /> : null}
      {tab === 'treasury' ? <TreasuryTab range={range} /> : null}
      {tab === 'expenses' ? <ExpensesTab range={range} /> : null}
      {tab === 'orders' ? <OrdersTab range={range} /> : null}
      {tab === 'delivery' ? <DeliveryTab range={range} /> : null}
      {tab === 'items' ? <ItemsTab range={range} /> : null}
      {tab === 'print' ? <PrintTab range={range} /> : null}
    </div>
  )
}

function TodayTab({ onGo }: { onGo: (t: Tab) => void }) {
  const q = useTodaySummary()
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={q.error instanceof Error ? q.error.message : t.reports.errors.generic}
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm" dir="ltr">
          {d.day}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() => void q.refetch()}
        >
          {t.reports.today.refresh}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t.reports.today.officialSales}
          value={formatMoney(d.official_sales_total)}
          mode="official"
          onClick={() => onGo('sales')}
        />
        <KpiCard
          label={t.reports.today.ordersCount}
          value={String(d.orders_count)}
          mode="ops"
        />
        <KpiCard
          label={t.reports.today.executedExpenses}
          value={formatMoney(d.executed_expenses_total)}
          mode="official"
          onClick={() => onGo('expenses')}
        />
        <KpiCard
          label={t.reports.today.operationalBalance}
          value={
            d.operational_drawer_balance == null
              ? '—'
              : formatMoney(d.operational_drawer_balance)
          }
          mode="operational"
          onClick={() => onGo('shift')}
        />
        <KpiCard
          label={t.reports.today.pendingCollections}
          value={`${d.pending_collections_count} · ${formatMoney(d.pending_collections_amount)}`}
          mode="operational"
        />
        <KpiCard
          label={t.reports.today.pendingExpenses}
          value={`${d.pending_expenses_count} · ${formatMoney(d.pending_expenses_amount)}`}
          mode="operational"
        />
        <KpiCard
          label={t.reports.today.voided}
          value={String(d.voided_orders_count)}
          mode="ops"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.reports.today.byMethod}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(d.by_payment_method ?? []).length === 0 ? (
            <p className="text-muted-foreground">—</p>
          ) : (
            d.by_payment_method.map((m) => (
              <div key={m.payment_method_id} className="flex justify-between gap-2">
                <span>
                  {m.name}{' '}
                  <span className="text-muted-foreground">({m.count})</span>
                </span>
                <Money value={m.amount} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.reports.today.byType}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {(d.orders_by_type ?? []).map((row) => (
            <div key={row.order_type} className="flex justify-between gap-2">
              <span>
                {orderTypeLabel(row.order_type)}{' '}
                <span className="text-muted-foreground">({row.count})</span>
              </span>
              <Money value={row.order_total_sum} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.reports.today.alerts}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(d.alerts ?? []).length === 0 ? (
            <p className="text-muted-foreground">{t.reports.today.noAlerts}</p>
          ) : (
            d.alerts.map((a) => (
              <div
                key={a.code}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
              >
                {a.message}
                {a.count != null ? ` · ${a.count}` : ''}
                {a.amount != null ? ` · ${formatMoney(a.amount)}` : ''}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ShiftTab({ range }: { range: { from: string; to: string } }) {
  const shifts = useShiftsForReports(range)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const report = useShiftReport(shiftId)

  return (
    <div className="space-y-4">
      {shifts.isLoading ? <LoadingState /> : null}
      {shifts.isError ? (
        <ErrorState
          description={
            shifts.error instanceof Error
              ? shifts.error.message
              : t.reports.errors.generic
          }
          onRetry={() => void shifts.refetch()}
        />
      ) : null}
      {shifts.data ? (
        <label className="block max-w-md space-y-1 text-sm print:hidden">
          <span className="text-muted-foreground text-xs font-semibold">
            {t.reports.shift.pick}
          </span>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3"
            value={shiftId ?? ''}
            onChange={(e) => setShiftId(e.target.value || null)}
          >
            <option value="">{t.reports.shift.pick}</option>
            {shifts.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.reference} · {s.status} · {formatDateTime(s.opened_at)}
              </option>
            ))}
          </select>
          {shifts.data.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t.reports.shift.noShifts}
            </p>
          ) : null}
        </label>
      ) : null}

      {report.isLoading ? <LoadingState /> : null}
      {report.data ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {String(report.data.reference ?? '')}
            </CardTitle>
            <div className="flex gap-2">
              <ModeBadge mode="official" />
              <ModeBadge mode="operational" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label={t.reports.shift.approvedRevenue}>
              <Money value={Number(report.data.approved_revenue ?? 0)} />
            </Row>
            <Row label={t.reports.shift.expected}>
              <Money value={Number(report.data.expected_cash ?? 0)} />
            </Row>
            <Row label={t.reports.shift.actual}>
              <Money
                value={
                  report.data.actual_cash == null
                    ? null
                    : Number(report.data.actual_cash)
                }
              />
            </Row>
            <Row label={t.reports.shift.variance}>
              <Money value={Number(report.data.variance ?? 0)} />
            </Row>
            <Row label={t.reports.today.operationalBalance}>
              <Money
                value={
                  report.data.operational_drawer_balance == null
                    ? null
                    : Number(report.data.operational_drawer_balance)
                }
              />
            </Row>
            <Row label={t.reports.today.pendingCollections}>
              {String(report.data.pending_collections_count ?? 0)} ·{' '}
              <Money
                value={Number(report.data.pending_collections_amount ?? 0)}
              />
            </Row>
            <Row label={t.reports.today.pendingExpenses}>
              {String(report.data.pending_expenses_count ?? 0)} ·{' '}
              <Money value={Number(report.data.pending_expenses_amount ?? 0)} />
            </Row>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function SalesTab({ range }: { range: { from: string; to: string } }) {
  const q = useOfficialSales(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={q.error instanceof Error ? q.error.message : t.reports.errors.generic}
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeBadge mode="official" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() =>
            downloadCsv(`sales-${range.from}_${range.to}.csv`, [
              ['day', 'count', 'amount'],
              ...d.by_day.map((r) => [
                String(r.day),
                String(r.count),
                String(r.amount),
              ]),
            ])
          }
        >
          {t.reports.export.csv}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label={t.reports.sales.total}
          value={formatMoney(d.official_sales_total)}
          mode="official"
        />
        <KpiCard
          label={t.reports.sales.collections}
          value={String(d.approved_collection_count)}
          mode="official"
          hint={t.reports.sales.voidedNote}
        />
      </div>
      <BreakdownCard
        title={t.reports.sales.byMethod}
        rows={(d.by_payment_method ?? []).map((m) => ({
          label: `${m.name} (${m.count})`,
          amount: m.amount,
        }))}
      />
      <BreakdownCard
        title={t.reports.sales.byType}
        rows={(d.by_order_type ?? []).map((m) => ({
          label: `${orderTypeLabel(m.order_type)} (${m.order_count})`,
          amount: m.amount,
        }))}
      />
      <BreakdownCard
        title={t.reports.sales.byDay}
        rows={(d.by_day ?? []).map((m) => ({
          label: `${m.day} (${m.count})`,
          amount: m.amount,
        }))}
      />
    </div>
  )
}

function TreasuryTab({ range }: { range: { from: string; to: string } }) {
  const balances = useBalances()
  const [treasuryId, setTreasuryId] = useState<string | null>(null)
  const ledger = useTreasuryLedgerReport(treasuryId, range)

  return (
    <div className="space-y-4">
      {balances.isLoading ? <LoadingState /> : null}
      <label className="block max-w-md space-y-1 text-sm print:hidden">
        <span className="text-muted-foreground text-xs font-semibold">
          {t.reports.treasury.pick}
        </span>
        <select
          className="border-input bg-background h-10 w-full rounded-md border px-3"
          value={treasuryId ?? ''}
          onChange={(e) => setTreasuryId(e.target.value || null)}
        >
          <option value="">{t.reports.treasury.pick}</option>
          {(balances.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {formatMoney(b.balance)}
            </option>
          ))}
        </select>
      </label>
      {ledger.isLoading ? <LoadingState /> : null}
      {ledger.isError ? (
        <ErrorState
          description={
            ledger.error instanceof Error
              ? ledger.error.message
              : t.reports.errors.generic
          }
          onRetry={() => void ledger.refetch()}
        />
      ) : null}
      {ledger.data ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{ledger.data.treasury_name}</CardTitle>
            <ModeBadge mode="official" />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              {t.reports.treasury.balance}:{' '}
              <Money value={ledger.data.official_balance} />
            </p>
            <p className="font-semibold">{t.reports.treasury.movements}</p>
            {(ledger.data.rows ?? []).length === 0 ? (
              <p className="text-muted-foreground">{t.reports.treasury.empty}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {ledger.data.rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">{r.source}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(r.created_at)}
                        {r.reference ? ` · ${r.reference}` : ''}
                      </p>
                    </div>
                    <Money value={r.amount} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ExpensesTab({ range }: { range: { from: string; to: string } }) {
  const q = useExpensesReport(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={q.error instanceof Error ? q.error.message : t.reports.errors.generic}
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label={t.reports.expenses.executed}
          value={`${d.executed_count} · ${formatMoney(d.executed_total)}`}
          mode="official"
        />
        <KpiCard
          label={t.reports.expenses.pending}
          value={`${d.pending_count} · ${formatMoney(d.pending_total)}`}
          mode="operational"
        />
      </div>
      <BreakdownCard
        title={t.reports.expenses.byCategory}
        rows={(d.by_category ?? []).map((c) => ({
          label: `${c.category} (${c.count})`,
          amount: c.amount,
        }))}
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.reports.expenses.rows}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-xl border text-sm">
            {(d.rows ?? []).map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div>
                  <p className="font-medium">
                    {r.category} · {r.status}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDateTime(r.created_at)}
                    {r.treasury_name ? ` · ${r.treasury_name}` : ''}
                  </p>
                </div>
                <Money value={r.amount} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function OrdersTab({ range }: { range: { from: string; to: string } }) {
  const q = useOrdersSummary(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.reports.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeBadge mode="ops" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() =>
            downloadCsv(`orders-${range.from}_${range.to}.csv`, [
              ['section', 'key', 'count', 'total'],
              [
                'active',
                'all',
                String(d.active_orders_count),
                String(d.active_orders_total),
              ],
              [
                'voided',
                'all',
                String(d.voided_orders_count),
                String(d.voided_orders_total),
              ],
              ...(d.by_order_type ?? []).map((r) => [
                'type',
                r.order_type,
                String(r.count),
                String(r.total),
              ]),
              ...(d.by_status ?? []).map((r) => [
                'status',
                r.status,
                String(r.count),
                String(r.total),
              ]),
              ...(d.by_payment_status ?? []).map((r) => [
                'payment',
                r.payment_status,
                String(r.count),
                String(r.total),
              ]),
            ])
          }
        >
          {t.reports.export.csv}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          label={t.reports.orders.active}
          value={`${d.active_orders_count} · ${formatMoney(d.active_orders_total)}`}
          mode="ops"
        />
        <KpiCard
          label={t.reports.orders.voided}
          value={`${d.voided_orders_count} · ${formatMoney(d.voided_orders_total)}`}
          mode="ops"
        />
      </div>
      <BreakdownCard
        title={t.reports.orders.byType}
        rows={(d.by_order_type ?? []).map((r) => ({
          label: `${orderTypeLabel(r.order_type)} (${r.count})`,
          amount: r.total,
        }))}
      />
      <BreakdownCard
        title={t.reports.orders.byStatus}
        rows={(d.by_status ?? []).map((r) => ({
          label: `${r.status} (${r.count})`,
          amount: r.total,
        }))}
      />
      <BreakdownCard
        title={t.reports.orders.byPayment}
        rows={(d.by_payment_status ?? []).map((r) => ({
          label: `${r.payment_status} (${r.count})`,
          amount: r.total,
        }))}
      />
    </div>
  )
}

function DeliveryTab({ range }: { range: { from: string; to: string } }) {
  const q = useDeliveryByDriver(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.reports.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeBadge mode="ops" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() =>
            downloadCsv(`delivery-${range.from}_${range.to}.csv`, [
              ['driver_id', 'driver_name', 'order_count', 'order_total_sum'],
              ...(d.by_driver ?? []).map((r) => [
                r.driver_id,
                r.driver_name,
                String(r.order_count),
                String(r.order_total_sum),
              ]),
              [
                '',
                t.reports.delivery.unassigned,
                String(d.unassigned_delivery_count),
                '',
              ],
            ])
          }
        >
          {t.reports.export.csv}
        </Button>
      </div>
      <KpiCard
        label={t.reports.delivery.unassigned}
        value={String(d.unassigned_delivery_count)}
        mode="ops"
      />
      {(d.by_driver ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.reports.delivery.empty}</p>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.reports.delivery.byDriver}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y text-sm">
              {(d.by_driver ?? []).map((r) => (
                <li
                  key={r.driver_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="font-medium">
                    {r.driver_name}
                    <span className="text-muted-foreground"> · {r.order_count}</span>
                  </span>
                  <Money value={r.order_total_sum} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ItemsTab({ range }: { range: { from: string; to: string } }) {
  const q = useItemMix(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.reports.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeBadge mode="ops" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() =>
            downloadCsv(`items-${range.from}_${range.to}.csv`, [
              ['item_name', 'category_name', 'qty_sold', 'sales_total', 'order_count'],
              ...(d.by_item ?? []).map((r) => [
                r.item_name,
                r.category_name,
                String(r.qty_sold),
                String(r.sales_total),
                String(r.order_count),
              ]),
            ])
          }
        >
          {t.reports.export.csv}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t.reports.items.note}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.reports.items.byItem}</CardTitle>
          </CardHeader>
          <CardContent>
            {(d.by_item ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">—</p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {(d.by_item ?? []).map((r) => (
                  <li
                    key={`${r.item_name}-${r.category_name}`}
                    className="flex justify-between gap-2 py-2"
                  >
                    <span>
                      {r.item_name}
                      <span className="text-muted-foreground">
                        {' '}
                        · {r.category_name} · {t.reports.items.qty} {r.qty_sold}
                      </span>
                    </span>
                    <Money value={r.sales_total} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.reports.items.byCategory}</CardTitle>
          </CardHeader>
          <CardContent>
            {(d.by_category ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">—</p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {(d.by_category ?? []).map((r) => (
                  <li
                    key={r.category_name}
                    className="flex justify-between gap-2 py-2"
                  >
                    <span>
                      {r.category_name}
                      <span className="text-muted-foreground">
                        {' '}
                        · {t.reports.items.qty} {r.qty_sold}
                      </span>
                    </span>
                    <Money value={r.sales_total} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PrintTab({ range }: { range: { from: string; to: string } }) {
  const q = usePrintReliability(range)
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.reports.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeBadge mode="ops" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="print:hidden"
          onClick={() =>
            downloadCsv(`print-${range.from}_${range.to}.csv`, [
              ['metric', 'value'],
              [t.reports.printOps.total, String(d.jobs_total)],
              [t.reports.printOps.completed, String(d.completed)],
              [t.reports.printOps.failed, String(d.failed)],
              [t.reports.printOps.expired, String(d.expired)],
              [
                t.reports.printOps.successRate,
                d.success_rate == null ? '' : String(d.success_rate),
              ],
              ...(d.by_kind ?? []).map((k) => [
                `kind:${k.kind}`,
                String(k.count),
              ]),
            ])
          }
        >
          {t.reports.export.csv}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t.reports.printOps.total}
          value={String(d.jobs_total)}
          mode="ops"
        />
        <KpiCard
          label={t.reports.printOps.completed}
          value={String(d.completed)}
          mode="ops"
        />
        <KpiCard
          label={t.reports.printOps.failed}
          value={String(d.failed)}
          mode="ops"
        />
        <KpiCard
          label={t.reports.printOps.successRate}
          value={d.success_rate == null ? '—' : `${d.success_rate}%`}
          mode="ops"
        />
      </div>
      <CountBreakdownCard
        title={t.reports.printOps.byStatus}
        rows={(d.by_status ?? []).map((r) => ({
          label: r.status,
          count: r.count,
        }))}
      />
      <CountBreakdownCard
        title={t.reports.printOps.byKind}
        rows={(d.by_kind ?? []).map((r) => ({
          label: `${r.kind} (${r.completed}✓ / ${r.failed_or_expired}✗)`,
          count: r.count,
        }))}
      />
    </div>
  )
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string
  rows: { label: string; amount: number }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <span>{r.label}</span>
              <Money value={r.amount} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function CountBreakdownCard({
  title,
  rows,
}: {
  title: string
  rows: { label: string; count: number }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">—</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <span>{r.label}</span>
              <span className="font-medium tabular-nums" dir="ltr">
                {r.count}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-between gap-2 border-b border-dashed py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}
