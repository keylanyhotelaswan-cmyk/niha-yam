import { useQuery } from '@tanstack/react-query'
import { methodLabel } from '@/features/orders/components/PaymentBreakdownBadges'
import { fetchShiftExpenses } from '@/features/treasury/api/treasury.api'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { formatMoney } from '@/features/treasury/utils/format'
import type { ExpenseRow, ShiftReport } from '@/features/treasury/types'
import { t } from '@/shared/i18n'

type Row = { label: string; value: number; tone?: 'in' | 'out' }

export type ShiftCollectionStatusTotals = {
  paid: number
  unpaid: number
  partial: number
}

export type ShiftPaymentMethodTotal = {
  payment_method_id?: string
  code: string
  name?: string
  amount: number
}

type Props = {
  report: ShiftReport
  /** Order payment_status totals for the active summary scope (shift or day). */
  collectionStatusTotals?: ShiftCollectionStatusTotals | null
  /** Payment-method breakdown for the same scope as collectionStatusTotals. */
  paymentMethodTotals?: ShiftPaymentMethodTotal[] | null
  /** Cash that counts toward drawer (from collection totals RPC). */
  trustCashTotal?: number | null
  /**
   * Manager/admin only: pending vs approved KPIs.
   * Cashiers see revenue as normal collected income — no pending/approved axis.
   */
  showApprovalMetrics?: boolean
}

function categoryLabel(code: string): string {
  const map = t.treasury.expenseCategory as Record<string, string>
  return map[code] ?? code
}

function statusLabel(status: string): string {
  const map = t.treasury.status as Record<string, string>
  return map[status] ?? status
}

/**
 * Ledger-derived shift breakdown (admin approval metrics optional).
 * Cashier mode (showApprovalMetrics=false): cash sales + expected use the same
 * operational snapshot as the POS payment strip / drawer (pending+approved).
 */
export function ShiftSummary({
  report,
  collectionStatusTotals,
  paymentMethodTotals,
  trustCashTotal,
  showApprovalMetrics = false,
}: Props) {
  const expensesQuery = useQuery({
    queryKey: [...treasuryKeys.all, 'shift-summary-expenses', report.id],
    queryFn: () => fetchShiftExpenses(report.id),
    enabled: Boolean(report.id),
  })

  // Prefer order-derived totals (pending + approved). Fall back to shift pending-only.
  const methods = (
    paymentMethodTotals ??
    (report.pending_by_payment_method ?? []).map((m) => ({
      payment_method_id: m.payment_method_id,
      code: m.code,
      name: m.name,
      amount: Number(m.amount),
    }))
  ).filter((m) => Math.abs(Number(m.amount)) > 0.001)

  const operationalCashSales = methods
    .filter((m) => m.code === 'cash')
    .reduce((sum, m) => sum + Number(m.amount ?? 0), 0)

  const cashSales = showApprovalMetrics
    ? Number(report.cash_sales ?? 0)
    : trustCashTotal != null
      ? trustCashTotal
      : paymentMethodTotals != null
        ? operationalCashSales
        : Number(report.cash_sales ?? 0)

  const pendingExpenses = Number(report.pending_expenses_amount ?? 0)

  // Shift-only expected: never add treasury-derived opening_balance (carried vault).
  const shiftOnlyExpected =
    Number(report.opening_float ?? 0) +
    cashSales -
    Number(report.cash_drops ?? 0) -
    Number(report.expenses ?? 0) -
    pendingExpenses +
    Number(report.transfers_in ?? 0) +
    Number(report.deposits ?? 0) -
    Number(report.withdrawals ?? 0) +
    Number(report.refunds ?? 0)

  const expectedCash =
    report.operational_drawer_balance != null
      ? Number(report.operational_drawer_balance)
      : showApprovalMetrics
        ? Number(report.expected_cash ?? 0)
        : paymentMethodTotals != null || trustCashTotal != null
          ? shiftOnlyExpected
          : Number(report.expected_cash ?? 0)

  const rows: Row[] = [
    { label: t.treasury.shift.openingFloat, value: report.opening_float },
    { label: t.treasury.shift.cashSales, value: cashSales, tone: 'in' },
    { label: t.treasury.shift.cashDrops, value: -report.cash_drops, tone: 'out' },
    { label: t.treasury.shift.expensesOut, value: -report.expenses, tone: 'out' },
  ]

  const status =
    collectionStatusTotals ??
    ({
      paid: 0,
      unpaid: 0,
      partial: 0,
    } satisfies ShiftCollectionStatusTotals)
  const hasStatus =
    collectionStatusTotals != null &&
    (status.paid > 0.001 || status.unpaid > 0.001 || status.partial > 0.001)

  const expenseRows = expensesQuery.data ?? []

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-muted-foreground">{row.label}</span>
            <span
              className={
                row.tone === 'out'
                  ? 'text-destructive'
                  : row.tone === 'in'
                    ? 'text-success'
                    : ''
              }
            >
              {formatMoney(row.value)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t pt-2 font-semibold">
          <span>{t.treasury.shift.expectedCash}</span>
          <span>{formatMoney(expectedCash)}</span>
        </div>
        {showApprovalMetrics && report.approved_revenue != null ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t.treasury.shift.approvedRevenue}
            </span>
            <span className="text-success">
              {formatMoney(Number(report.approved_revenue))}
            </span>
          </div>
        ) : null}
        {showApprovalMetrics &&
        (report.pending_collections_amount ?? 0) > 0.001 ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t.treasury.shift.pendingCollections}
            </span>
            <span>
              {formatMoney(Number(report.pending_collections_amount))}
              {report.pending_collections_count
                ? ` (${report.pending_collections_count})`
                : ''}
            </span>
          </div>
        ) : null}
        {showApprovalMetrics && pendingExpenses > 0.001 ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t.treasury.shift.pendingExpenses}
            </span>
            <span>
              {formatMoney(pendingExpenses)}
              {report.pending_expenses_count
                ? ` (${report.pending_expenses_count})`
                : ''}
            </span>
          </div>
        ) : null}
        {!showApprovalMetrics && pendingExpenses > 0.001 ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#b45309]">{t.treasury.shift.pendingExpenses}</span>
            <span className="text-[#b45309]">
              {formatMoney(-pendingExpenses)}
              {report.pending_expenses_count
                ? ` (${report.pending_expenses_count})`
                : ''}
            </span>
          </div>
        ) : null}
      </div>

      <ExpenseDetailsList
        loading={expensesQuery.isLoading}
        rows={expenseRows}
      />

      {hasStatus ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-muted-foreground text-xs font-semibold">
            {t.treasury.shift.collectionStatusHeading}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <StatusCell
              label={t.orders.status.payment.paid}
              value={status.paid}
              tone="text-[#15803d] bg-[#dcfce7]"
            />
            <StatusCell
              label={t.orders.status.payment.unpaid}
              value={status.unpaid}
              tone="text-[#b45309] bg-[#fffbeb]"
            />
            <StatusCell
              label={t.orders.status.payment.partial}
              value={status.partial}
              tone="text-[#b45309] bg-[#fef3c7]"
            />
          </div>
        </div>
      ) : null}

      {methods.length > 0 ? (
        <div className="space-y-1 border-t pt-3">
          <p className="text-muted-foreground mb-2 text-xs font-semibold">
            {t.treasury.shift.paymentMethodsHeading}
          </p>
          {methods.map((m) => (
            <div
              key={m.payment_method_id ?? m.code}
              className="flex items-center justify-between"
            >
              <span className="text-muted-foreground">
                {methodLabel(m.code, m.name)}
              </span>
              <span dir="ltr">{formatMoney(m.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ExpenseDetailsList({
  loading,
  rows,
}: {
  loading: boolean
  rows: ExpenseRow[]
}) {
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-muted-foreground text-xs font-semibold">
        {t.treasury.shift.expensesDetailHeading}
      </p>
      {loading ? (
        <p className="text-muted-foreground text-xs">{t.common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t.treasury.shift.expensesDetailEmpty}
        </p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {rows.map((e) => {
            const muted =
              e.status === 'reversed' || e.status === 'rejected'
            return (
              <li
                key={e.id}
                className={`rounded-xl border px-3 py-2 ${
                  muted
                    ? 'border-[#e2e8f0] bg-[#f8fafc] opacity-80'
                    : 'border-[#fecaca] bg-[#fef2f2]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-start">
                    <p className="font-semibold text-[#0f172a]">
                      {categoryLabel(e.category)}
                      {e.vendor ? (
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          · {e.vendor}
                        </span>
                      ) : null}
                    </p>
                    {e.description ? (
                      <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                        {e.description}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {statusLabel(e.status)}
                      {e.reference
                        ? ` · ${t.treasury.shift.expenseRef} ${e.reference}`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-bold ${
                      muted ? 'text-[#64748b] line-through' : 'text-destructive'
                    }`}
                    dir="ltr"
                  >
                    {formatMoney(-Number(e.amount))}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatusCell({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: string
}) {
  return (
    <div className={`rounded-xl px-2 py-2 text-center ${tone}`}>
      <p className="text-[10px] font-semibold opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-bold" dir="ltr">
        {formatMoney(value)}
      </p>
    </div>
  )
}
