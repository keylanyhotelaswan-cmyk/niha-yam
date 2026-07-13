import { formatMoney } from '@/features/treasury/utils/format'
import type { PaymentBreakdownRow } from '@/features/orders/types'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

function methodTone(code: string) {
  if (code === 'cash') return 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
  if (code === 'instapay') return 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
  if (code === 'ewallet') return 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
  return 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
}

export function methodLabel(code: string, name?: string) {
  if (code === 'cash') return t.orders.paymentMethods.cash
  if (code === 'instapay') return t.orders.paymentMethods.instapay
  if (code === 'ewallet' || code === 'wallet') return t.orders.paymentMethods.ewallet
  if (code === 'card' || code === 'cards') return t.orders.paymentMethods.card
  return name ?? code
}

type Props = {
  rows: PaymentBreakdownRow[] | null | undefined
  compact?: boolean
}

export function PaymentBreakdownBadges({ rows, compact }: Props) {
  if (!rows?.length) {
    return (
      <span className="text-[11px] text-[#94a3b8]">
        {t.orders.paymentMethods.none}
      </span>
    )
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', compact && 'gap-1')}>
      {rows.map((r) => (
        <span
          key={r.payment_method_id}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold',
            methodTone(r.code),
          )}
        >
          {methodLabel(r.code, r.name)}
          <span dir="ltr">{formatMoney(Number(r.amount))}</span>
        </span>
      ))}
    </div>
  )
}

type TotalsProps = {
  rows: Array<{
    payment_method_id?: string
    code: string
    name?: string
    amount: number
  }>
  /** Compact hub strip (default). */
  compact?: boolean
}

/** Aggregate payment-method totals — shows whatever methods exist (future-safe). */
export function PaymentMethodTotalsStrip({
  rows,
  compact = true,
}: TotalsProps) {
  const toneFor = (code: string) => {
    if (code === 'cash') return 'bg-[#dcfce7] text-[#15803d]'
    if (code === 'instapay') return 'bg-[#eff6ff] text-[#2563eb]'
    if (code === 'ewallet' || code === 'wallet') return 'bg-[#fffbeb] text-[#b45309]'
    if (code === 'card' || code === 'cards' || code === 'visa' || code === 'mastercard')
      return 'bg-[#f3e8ff] text-[#7c3aed]'
    return 'bg-[#f8fafc] text-[#475569]'
  }

  const byCode = new Map<string, { label: string; amount: number }>()
  for (const r of rows) {
    const prev = byCode.get(r.code)
    byCode.set(r.code, {
      label: methodLabel(r.code, r.name),
      amount: (prev?.amount ?? 0) + Number(r.amount),
    })
  }

  const preferred = ['cash', 'card', 'cards', 'instapay', 'ewallet', 'wallet']
  const ordered = [
    ...preferred.filter((c) => byCode.has(c)),
    ...[...byCode.keys()].filter((c) => !preferred.includes(c)),
  ]

  const cells = ordered
    .map((code) => {
      const v = byCode.get(code)!
      return {
        code,
        label: v.label,
        amount: v.amount,
        tone: toneFor(code),
      }
    })
    .filter((c) => Math.abs(c.amount) > 0.001)

  if (cells.length === 0) {
    return (
      <span className="text-[10px] text-[#94a3b8]">
        {t.orders.paymentMethods.none}
      </span>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {cells.map((c) => (
          <div
            key={c.code}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2 py-1',
              c.tone,
            )}
          >
            <span className="text-[10px] font-semibold opacity-80">{c.label}</span>
            <span className="text-xs font-bold" dir="ltr">
              {formatMoney(c.amount)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'grid gap-2',
        cells.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4',
      )}
    >
      {cells.map((c) => (
        <div
          key={c.code}
          className={cn(
            'rounded-2xl border border-white/80 px-3 py-2.5 shadow-[0_2px_10px_rgba(15,23,42,0.04)]',
            c.tone,
          )}
        >
          <p className="text-[11px] font-semibold opacity-80">{c.label}</p>
          <p className="mt-0.5 text-lg font-bold" dir="ltr">
            {formatMoney(c.amount)}
          </p>
        </div>
      ))}
    </div>
  )
}
