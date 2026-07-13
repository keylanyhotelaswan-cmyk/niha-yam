import { methodLabel } from '@/features/orders/components/PaymentBreakdownBadges'
import { formatMoney } from '@/features/treasury/utils/format'
import type { ShiftReport } from '@/features/treasury/types'
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
  /**
   * Manager/admin only: pending vs approved KPIs.
   * Cashiers see revenue as normal collected income — no pending/approved axis.
   */
  showApprovalMetrics?: boolean
}

/**
 * Ledger-derived shift breakdown (no summary tables). Shows the chain that
 * explains the final drawer balance: float → sales → drops/expenses → expected,
 * plus payment methods and collection-status totals when provided.
 */
export function ShiftSummary({
  report,
  collectionStatusTotals,
  paymentMethodTotals,
  showApprovalMetrics = false,
}: Props) {
  const rows: Row[] = [
    ...(Math.abs(report.opening_balance) > 0.001
      ? [{ label: t.treasury.shift.carriedOver, value: report.opening_balance }]
      : []),
    { label: t.treasury.shift.openingFloat, value: report.opening_float },
    { label: t.treasury.shift.cashSales, value: report.cash_sales, tone: 'in' },
    { label: t.treasury.shift.cashDrops, value: -report.cash_drops, tone: 'out' },
    { label: t.treasury.shift.expensesOut, value: -report.expenses, tone: 'out' },
  ]

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
          <span>{formatMoney(report.expected_cash)}</span>
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
        {showApprovalMetrics &&
        (report.pending_expenses_amount ?? 0) > 0.001 ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {t.treasury.shift.pendingExpenses}
            </span>
            <span>
              {formatMoney(Number(report.pending_expenses_amount))}
              {report.pending_expenses_count
                ? ` (${report.pending_expenses_count})`
                : ''}
            </span>
          </div>
        ) : null}
      </div>

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
