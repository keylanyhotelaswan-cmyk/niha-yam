import type { ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSmartShiftSheet,
  reviewShiftHandover,
} from '@/features/treasury/api/smartHandover.api'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { t } from '@/shared/i18n'
import { toast } from 'sonner'

type Props = { shiftId: string }

function categoryLabel(code: string) {
  const map = t.treasury.expenseCategory as Record<string, string>
  return map[code] ?? code
}

function payMethodLabel(code: string) {
  if (code === 'cash') return 'نقدي'
  if (code === 'credit') return 'آجل'
  return code
}

export function SmartShiftSheet({ shiftId }: Props) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: [...treasuryKeys.all, 'smart-sheet', shiftId],
    queryFn: () => fetchSmartShiftSheet(shiftId),
  })
  const review = useMutation({
    mutationFn: ({
      id,
      decision,
      notes,
    }: {
      id: string
      decision: 'approved' | 'rejected'
      notes?: string
    }) => reviewShiftHandover(id, decision, notes),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: treasuryKeys.all })
      toast.success(t.treasury.smartHandover.reviewSaved)
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t.treasury.errors.generic),
  })

  if (q.isLoading) return <LoadingState />
  const d = q.data
  if (!d) return null

  const report = d.report ?? {}
  const collections = d.collections ?? {}
  const ops = d.ops_summary
  const h = d.handover
  const expected = Number(report.expected_cash ?? 0)
  const actual = Number(d.shift.actual_cash_count ?? report.actual_cash ?? 0)
  const variance = Number(report.variance ?? actual - expected)

  return (
    <div className="space-y-5 text-sm">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold">
          {t.treasury.smartHandover.title}
        </h3>
        <p className="text-muted-foreground text-xs">
          {t.treasury.smartHandover.reviewNote}
        </p>
      </header>

      <Section title={t.treasury.smartHandover.shiftMeta}>
        <Row label="رقم الوردية" value={d.shift.reference} />
        <Row label="الكاشير" value={d.shift.opened_by_name ?? '—'} />
        <Row label="فتحت الساعة" value={formatDateTime(d.shift.opened_at)} />
        <Row
          label="قفلت الساعة"
          value={d.shift.closed_at ? formatDateTime(d.shift.closed_at) : '—'}
        />
        <Row
          label="مدّتها"
          value={`${d.shift.duration_minutes ?? '—'} دقيقة`}
        />
        <Row label="عدد الطلبات" value={String(d.orders_count ?? 0)} />
        <Row
          label="إجمالي المبيعات"
          value={`${formatMoney(Number(d.sales_total ?? 0))} ج.م`}
          ltr
        />
      </Section>

      <Section title="فلوس الدرج">
        <Row label="المتوقع داخل الدرج" value={`${formatMoney(expected)} ج.م`} ltr />
        <Row label="اللي سلّمه الكاشير" value={`${formatMoney(actual)} ج.م`} ltr />
        <Row
          label={variance >= 0 ? 'زيادة' : 'عجز'}
          value={`${formatMoney(Math.abs(variance))} ج.م`}
          ltr
        />
      </Section>

      <Section title="التحصيل حسب طريقة الدفع">
        {(collections.by_payment_method ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {(collections.by_payment_method ?? []).map(
              (m: { payment_method_id?: string; name: string; amount: number }) => (
                <li
                  key={m.payment_method_id ?? m.name}
                  className="flex justify-between gap-2"
                >
                  <span>{m.name}</span>
                  <span dir="ltr">{formatMoney(Number(m.amount))} ج.م</span>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>

      <Section title="المصروفات بالتفصيل">
        {(d.expenses ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {(d.expenses ?? []).map((e) => (
              <li key={e.reference} className="rounded border px-3 py-2">
                <div className="flex justify-between gap-2 font-medium">
                  <span>
                    {categoryLabel(e.category)}
                    {e.vendor ? ` — ${e.vendor}` : ''}
                  </span>
                  <span dir="ltr">{formatMoney(Number(e.amount))} ج.م</span>
                </div>
                {e.description ? (
                  <p className="text-muted-foreground text-xs">{e.description}</p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {e.reference}
                  {e.created_at ? ` · ${formatDateTime(e.created_at)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="شراء البضاعة بالتفصيل">
        {(d.purchases ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-3">
            {(d.purchases ?? []).map((p) => (
              <li key={p.reference} className="rounded border px-3 py-2">
                <div className="flex justify-between gap-2 font-medium">
                  <span>
                    {p.reference} · {payMethodLabel(p.payment_method)}
                    {p.supplier_name_ar
                      ? ` · ${p.supplier_name_ar}`
                      : p.direct_label
                        ? ` · ${p.direct_label}`
                        : ''}
                  </span>
                  <span dir="ltr">
                    {formatMoney(Number(p.total_amount))} ج.م
                  </span>
                </div>
                {(p.lines ?? []).length > 0 ? (
                  <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                    {p.lines!.map((l, idx) => (
                      <li key={`${p.reference}-${idx}`} className="flex justify-between gap-2">
                        <span>
                          {l.ingredient_name_ar} × {l.qty}
                        </span>
                        <span dir="ltr">
                          {formatMoney(Number(l.line_total))} ج.م
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="سداد الموردين">
        {(d.supplier_payments ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {(d.supplier_payments ?? []).map((p) => (
              <li key={p.reference} className="flex justify-between gap-2">
                <span>
                  {p.supplier_name_ar} · {p.reference}
                </span>
                <span dir="ltr">{formatMoney(Number(p.amount))} ج.م</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="تحويلات بين الخزن">
        {(d.transfers ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-1">
            {(d.transfers ?? []).map((tr) => (
              <li key={tr.reference} className="flex justify-between gap-2">
                <span>
                  {tr.is_cash_drop ? 'تحويل نقدي للخزنة' : 'تحويل'} ·{' '}
                  {tr.reference}
                  {tr.reason ? ` — ${tr.reason}` : ''}
                </span>
                <span dir="ltr">{formatMoney(Number(tr.amount))} ج.م</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="خصومات وطلبات ملغاة">
        <Row
          label="إجمالي الخصومات"
          value={`${formatMoney(Number(d.discounts_total ?? 0))} ج.م`}
          ltr
        />
        <Row
          label="عدد الطلبات الملغاة"
          value={String(d.cancelled_orders ?? 0)}
        />
      </Section>

      {ops ? (
        <Section title="ملخص سريع للمدير">
          <Row label="دخل كام" value={`${formatMoney(Number(ops.income))} ج.م`} ltr />
          <Row
            label="اتصرف كام (مصروفات)"
            value={`${formatMoney(Number(ops.expenses))} ج.م`}
            ltr
          />
          <Row
            label="خرج كام شراء"
            value={`${formatMoney(Number(ops.purchases_cash))} ج.م`}
            ltr
          />
          <Row
            label="خرج كام سداد موردين"
            value={`${formatMoney(Number(ops.supplier_payments))} ج.م`}
            ltr
          />
          <Row
            label="خرج كام تحويل"
            value={`${formatMoney(Number(ops.transfers_out))} ج.م`}
            ltr
          />
          <Row
            label="المتبقي داخل الدرج"
            value={`${formatMoney(Number(ops.drawer_remaining))} ج.م`}
            ltr
          />
        </Section>
      ) : null}

      <Section title="أفضل 5 أصناف مبيعًا">
        {(d.top_items ?? []).length === 0 ? (
          <Empty />
        ) : (
          <ol className="list-decimal space-y-1 pr-5">
            {(d.top_items ?? []).slice(0, 5).map((it) => (
              <li key={it.name_ar} className="flex justify-between gap-2">
                <span>
                  {it.name_ar} ({it.qty} قطعة)
                </span>
                <span dir="ltr">{formatMoney(Number(it.sales))} ج.م</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {h ? (
        <Section title="مراجعة المدير (لا توقف التشغيل)">
          <Row label="رقم التسليم" value={h.reference} />
          <Row
            label="حالة الفلوس"
            value={
              h.status === 'executed'
                ? 'اتسلّمت واتحوّلت للخزنة'
                : h.status === 'pending'
                  ? 'بانتظار التسليم'
                  : h.status
            }
          />
          <Row
            label="حالة المراجعة"
            value={
              h.review_status === 'approved'
                ? 'تمت المراجعة'
                : h.review_status === 'rejected'
                  ? 'محتاجة مناقشة مع الموظف'
                  : 'لم تتم بعد'
            }
          />
          {h.review_notes ? (
            <p className="text-muted-foreground text-xs">
              ملاحظة: {h.review_notes}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              disabled={review.isPending}
              onClick={() =>
                review.mutate({
                  id: h.id,
                  decision: 'approved',
                  notes: 'تمت المراجعة',
                })
              }
            >
              تمّت المراجعة
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => {
                const notes = window.prompt('اكتب ملاحظة للموظف / سبب المناقشة')
                if (!notes?.trim()) {
                  toast.error(t.treasury.errors.REASON_REQUIRED)
                  return
                }
                review.mutate({
                  id: h.id,
                  decision: 'rejected',
                  notes: notes.trim(),
                })
              }}
            >
              سجّل ملاحظة للمراجعة
            </Button>
          </div>
          <div className="border-border mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs">توقيع المستلم</p>
              <div className="mt-8 border-b border-dashed" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs">ملاحظات المدير</p>
              <div className="mt-8 border-b border-dashed" />
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="border-border border-b pb-1 font-semibold">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Row({
  label,
  value,
  ltr,
}: {
  label: string
  value: string
  ltr?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" dir={ltr ? 'ltr' : undefined}>
        {value}
      </span>
    </div>
  )
}

function Empty() {
  return <p className="text-muted-foreground">لا يوجد</p>
}
