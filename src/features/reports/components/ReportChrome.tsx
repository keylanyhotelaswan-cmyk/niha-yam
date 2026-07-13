import { formatMoney } from '@/features/treasury/utils/format'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

export function ModeBadge({
  mode,
}: {
  mode: 'official' | 'operational' | 'ops'
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        mode === 'official' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        mode === 'operational' && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      {t.reports.mode[mode]}
    </Badge>
  )
}

export function KpiCard({
  label,
  value,
  mode,
  hint,
  onClick,
}: {
  label: string
  value: string
  mode?: 'official' | 'operational' | 'ops'
  hint?: string
  onClick?: () => void
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-2xl border border-[#e2e8f0] bg-white p-4 text-start shadow-sm',
        onClick && 'hover:border-[#93c5fd] hover:bg-[#f8fafc]',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-semibold">{label}</p>
        {mode ? <ModeBadge mode={mode} /> : null}
      </div>
      <p className="text-xl font-bold tabular-nums" dir="ltr">
        {value}
      </p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </Comp>
  )
}

export function Money({ value }: { value: number | null | undefined }) {
  if (value == null) return <span>—</span>
  return (
    <span className="tabular-nums" dir="ltr">
      {formatMoney(value)}
    </span>
  )
}

export function DateRangeFields({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs font-semibold">
          {t.reports.filters.from}
        </span>
        <input
          type="date"
          className="border-input bg-background block h-10 rounded-md border px-3 text-sm"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-muted-foreground text-xs font-semibold">
          {t.reports.filters.to}
        </span>
        <input
          type="date"
          className="border-input bg-background block h-10 rounded-md border px-3 text-sm"
          value={to}
          onChange={(e) => onTo(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground pb-2 text-xs">
        {t.reports.filters.rangeHint}
      </p>
    </div>
  )
}

export function orderTypeLabel(type: string): string {
  const map = t.reports.orderTypes as Record<string, string>
  return map[type] ?? type
}
