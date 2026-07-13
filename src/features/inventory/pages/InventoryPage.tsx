import { formatDateTime } from '@/features/treasury/utils/format'
import { useIngredients } from '@/features/recipes/hooks/useRecipesQueries'
import { useUoms } from '@/features/recipes/hooks/useRecipesQueries'
import {
  useInventoryDashboard,
  usePostStockMovement,
  useReverseStockMovement,
  useStockCard,
  useStockLevels,
  useUpsertStockSettings,
} from '@/features/inventory/hooks/useInventoryQueries'
import type { InvaMovementType, StockCardRow } from '@/features/inventory/types'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'
import { useState, type ReactNode } from 'react'

const TABS = ['dashboard', 'levels', 'card', 'post'] as const
type Tab = (typeof TABS)[number]

const POST_TYPES: InvaMovementType[] = [
  'opening',
  'receive',
  'issue',
  'waste',
  'adjustment',
]

function typeLabel(type: string) {
  const map = t.inventory.movementTypes as Record<string, string>
  return map[type] ?? type
}

function formatQty(n: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  }).format(n)
}

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [cardIngredientId, setCardIngredientId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader title={t.inventory.title} description={t.inventory.subtitle} />
      <div role="tablist" className="border-border flex flex-wrap gap-1 border-b">
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
            {t.inventory.tabs[value]}
          </Button>
        ))}
      </div>
      {tab === 'dashboard' ? <DashboardTab /> : null}
      {tab === 'levels' ? (
        <LevelsTab
          onOpenCard={(id) => {
            setCardIngredientId(id)
            setTab('card')
          }}
        />
      ) : null}
      {tab === 'card' ? (
        <CardTab
          ingredientId={cardIngredientId}
          onPick={setCardIngredientId}
        />
      ) : null}
      {tab === 'post' ? <PostTab /> : null}
    </div>
  )
}

function DashboardTab() {
  const q = useInventoryDashboard()
  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.inventory.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t.inventory.dashboard.total} value={String(d.ingredients_total)} />
        <Kpi label={t.inventory.dashboard.low} value={String(d.low_stock_count)} />
        <Kpi label={t.inventory.dashboard.out} value={String(d.out_of_stock_count)} />
        <Kpi
          label={t.inventory.dashboard.noMove}
          value={String(d.no_movement_14d_count)}
        />
        <Kpi
          label={t.inventory.dashboard.variance}
          value={String(d.variance_ingredients_count)}
        />
        <Kpi
          label={t.inventory.dashboard.nearExpiry}
          value={
            d.near_expiry_enabled
              ? String(d.near_expiry_count ?? 0)
              : t.inventory.dashboard.nearExpirySoon
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard
          title={t.inventory.dashboard.topConsumed}
          rows={(d.top_consumed ?? []).map(
            (r) => `${r.name_ar} · ${formatQty(Number(r.qty_base))}`,
          )}
        />
        <ListCard
          title={t.inventory.dashboard.topWaste}
          rows={(d.top_waste ?? []).map(
            (r) => `${r.name_ar} · ${formatQty(Number(r.qty_base))}`,
          )}
        />
        <ListCard
          title={t.inventory.dashboard.recentMovements}
          rows={(d.recent_movements ?? []).map(
            (m) =>
              `${formatDateTime(m.moved_at)} · ${typeLabel(m.movement_type)} · ${m.ingredient_name_ar} · ${m.reference}`,
          )}
        />
        <ListCard
          title={t.inventory.dashboard.recentCounts}
          rows={
            (d.recent_counts ?? []).length === 0
              ? []
              : (d.recent_counts ?? []).map(
                  (c) => `${c.status} · ${formatDateTime(c.created_at)}`,
                )
          }
        />
      </div>
    </div>
  )
}

function LevelsTab({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const levels = useStockLevels()
  const upsert = useUpsertStockSettings()
  const [editId, setEditId] = useState<string | null>(null)
  const [reorder, setReorder] = useState('0')

  if (levels.isLoading) return <LoadingState />
  if (levels.isError)
    return (
      <ErrorState
        description={
          levels.error instanceof Error
            ? levels.error.message
            : t.inventory.errors.generic
        }
        onRetry={() => void levels.refetch()}
      />
    )

  return (
    <Card>
      <CardContent className="pt-4">
        <ul className="divide-border divide-y text-sm">
          {(levels.data ?? []).map((row) => (
            <li
              key={row.ingredient_id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <p className="font-medium">{row.name_ar}</p>
                <p className="text-muted-foreground text-xs">
                  {t.inventory.levels.onHand}:{' '}
                  <span dir="ltr">{formatQty(Number(row.on_hand))}</span>{' '}
                  {row.base_uom_name_ar}
                  {row.is_out ? ` · ${t.inventory.levels.out}` : ''}
                  {row.is_low ? ` · ${t.inventory.levels.low}` : ''}
                  {Number(row.on_hand) < 0
                    ? ` · ${t.inventory.levels.warningNeg}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editId === row.ingredient_id ? (
                  <>
                    <Input
                      className="w-24"
                      type="number"
                      min="0"
                      value={reorder}
                      onChange={(e) => setReorder(e.target.value)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        void upsert
                          .mutateAsync({
                            ingredientId: row.ingredient_id,
                            reorderLevel: Number(reorder),
                          })
                          .then(() => setEditId(null))
                      }
                    >
                      {t.inventory.levels.setReorder}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditId(row.ingredient_id)
                      setReorder(String(row.reorder_level))
                    }}
                  >
                    {t.inventory.levels.reorder}: {formatQty(Number(row.reorder_level))}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onOpenCard(row.ingredient_id)}
                >
                  {t.inventory.levels.openCard}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function CardTab({
  ingredientId,
  onPick,
}: {
  ingredientId: string | null
  onPick: (id: string | null) => void
}) {
  const levels = useStockLevels()
  const card = useStockCard(ingredientId)
  const reverse = useReverseStockMovement()
  const [detail, setDetail] = useState<StockCardRow | null>(null)

  return (
    <div className="space-y-4">
      <Field label={t.inventory.card.pick}>
        <select
          className="border-input bg-background h-10 w-full max-w-md rounded-md border px-3 text-sm"
          value={ingredientId ?? ''}
          onChange={(e) => onPick(e.target.value || null)}
        >
          <option value="">—</option>
          {(levels.data ?? []).map((i) => (
            <option key={i.ingredient_id} value={i.ingredient_id}>
              {i.name_ar}
            </option>
          ))}
        </select>
      </Field>

      {card.isLoading ? <LoadingState /> : null}
      {card.isError ? (
        <ErrorState
          description={
            card.error instanceof Error
              ? card.error.message
              : t.inventory.errors.generic
          }
        />
      ) : null}

      {card.data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">
                {t.inventory.card.title} — {card.data.ingredient_name_ar}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t.inventory.card.onHand}:{' '}
                <span dir="ltr" className="font-medium text-foreground">
                  {formatQty(Number(card.data.on_hand))}
                </span>{' '}
                {card.data.base_uom_name_ar}
                {card.data.negative_stock_warning
                  ? ` · ${t.inventory.levels.warningNeg}`
                  : ''}
              </p>
            </div>
          </div>
          {(card.data.rows ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.inventory.card.empty}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-xs">
                  <tr>
                    <th className="p-2 text-start">{t.inventory.card.date}</th>
                    <th className="p-2 text-start">{t.inventory.card.type}</th>
                    <th className="p-2 text-start">{t.inventory.card.reference}</th>
                    <th className="p-2 text-start">{t.inventory.card.user}</th>
                    <th className="p-2 text-end">{t.inventory.card.in}</th>
                    <th className="p-2 text-end">{t.inventory.card.out}</th>
                    <th className="p-2 text-end">{t.inventory.card.balance}</th>
                    <th className="p-2 text-start">{t.inventory.card.reason}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {(card.data.rows ?? []).map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">
                        {formatDateTime(r.moved_at)}
                      </td>
                      <td className="p-2">{typeLabel(r.movement_type)}</td>
                      <td className="p-2 font-mono text-xs" dir="ltr">
                        {r.reference}
                      </td>
                      <td className="p-2">{r.created_by_name ?? '—'}</td>
                      <td className="p-2 text-end tabular-nums" dir="ltr">
                        {Number(r.qty_in) > 0 ? formatQty(Number(r.qty_in)) : '—'}
                      </td>
                      <td className="p-2 text-end tabular-nums" dir="ltr">
                        {Number(r.qty_out) > 0 ? formatQty(Number(r.qty_out)) : '—'}
                      </td>
                      <td className="p-2 text-end font-medium tabular-nums" dir="ltr">
                        {formatQty(Number(r.balance_after))}
                      </td>
                      <td className="p-2 text-muted-foreground max-w-[10rem] truncate">
                        {r.reason ?? '—'}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetail(r)}
                          >
                            {t.inventory.card.source}
                          </Button>
                          {r.movement_type !== 'reverse' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={reverse.isPending}
                              onClick={() => {
                                if (!window.confirm(t.inventory.card.reverseConfirm))
                                  return
                                void reverse.mutateAsync({ movementId: r.id })
                              }}
                            >
                              {t.inventory.card.reverse}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {detail ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {typeLabel(detail.movement_type)} · {detail.reference}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {t.inventory.card.date}: {formatDateTime(detail.moved_at)}
            </p>
            <p>
              {t.inventory.card.user}: {detail.created_by_name ?? '—'}
            </p>
            <p>
              {t.inventory.card.reason}: {detail.reason ?? '—'}
            </p>
            <p>
              {t.inventory.card.source}:{' '}
              {detail.source_type
                ? `${(t.inventory.sourceTypes as Record<string, string>)[detail.source_type] ?? detail.source_type}${detail.source_id ? ` · ${detail.source_id}` : ''}`
                : '—'}
            </p>
            {detail.source_type === 'order' && detail.source_id ? (
              <p className="text-muted-foreground text-xs">
                {t.inventory.card.openSource}: order/{detail.source_id}
              </p>
            ) : null}
            {detail.reverses_movement_id ? (
              <p className="text-muted-foreground text-xs">
                reverses: {detail.reverses_movement_id}
              </p>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setDetail(null)}>
              {t.inventory.actions.cancel}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function PostTab() {
  const ingredients = useIngredients()
  const uoms = useUoms()
  const post = usePostStockMovement()
  const [ingredientId, setIngredientId] = useState('')
  const [type, setType] = useState<InvaMovementType>('receive')
  const [qty, setQty] = useState('1')
  const [uomId, setUomId] = useState('')
  const [reason, setReason] = useState('')
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [lastWarn, setLastWarn] = useState(false)
  const [lastRef, setLastRef] = useState<string | null>(null)

  const selected = (ingredients.data ?? []).find((i) => i.id === ingredientId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t.inventory.post.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid max-w-xl gap-3">
        <Field label={t.inventory.post.ingredient}>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={ingredientId}
            onChange={(e) => {
              setIngredientId(e.target.value)
              const ing = (ingredients.data ?? []).find(
                (i) => i.id === e.target.value,
              )
              if (ing) setUomId(ing.base_uom_id)
            }}
          >
            <option value="">—</option>
            {(ingredients.data ?? [])
              .filter((i) => i.is_active)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name_ar}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t.inventory.post.type}>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as InvaMovementType)}
          >
            {POST_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {typeLabel(ty)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.inventory.post.qty}>
            <Input
              type="number"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          <Field label={t.inventory.post.uom}>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={uomId}
              onChange={(e) => setUomId(e.target.value)}
            >
              <option value="">—</option>
              {(uoms.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name_ar}
                  {selected?.base_uom_id === u.id ? ' *' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {type === 'adjustment' ? (
          <Field label={t.inventory.post.direction}>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
            >
              <option value="in">{t.inventory.post.dirIn}</option>
              <option value="out">{t.inventory.post.dirOut}</option>
            </select>
          </Field>
        ) : null}
        <Field label={t.inventory.post.reason}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button
          type="button"
          disabled={post.isPending || !ingredientId || !uomId || Number(qty) <= 0}
          onClick={() =>
            void post
              .mutateAsync({
                ingredient_id: ingredientId,
                movement_type: type,
                qty: Number(qty),
                uom_id: uomId,
                reason: reason || undefined,
                direction: type === 'adjustment' ? direction : undefined,
              })
              .then((res) => {
                setLastWarn(!!res.negative_stock_warning)
                setLastRef(res.reference)
              })
          }
        >
          {t.inventory.post.submit}
        </Button>
        {post.isError ? (
          <p className="text-destructive text-sm">
            {post.error instanceof Error
              ? post.error.message
              : t.inventory.errors.generic}
          </p>
        ) : null}
        {lastRef ? (
          <p className="text-sm">
            {t.inventory.card.reference}: <span dir="ltr">{lastRef}</span>
            {lastWarn ? (
              <span className="text-amber-700"> · {t.inventory.post.negWarn}</span>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <p className="text-muted-foreground text-xs font-semibold">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  )
}

function ListCard({ title, rows }: { title: string; rows: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.inventory.dashboard.empty}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r} className="border-b border-dashed py-1 last:border-0">
                {r}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground text-xs font-semibold">{label}</span>
      {children}
    </label>
  )
}
