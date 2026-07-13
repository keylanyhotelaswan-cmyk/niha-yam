import { formatMoney } from '@/features/treasury/utils/format'
import {
  useCoverage,
  useIngredients,
  useMenuItemCost,
  useMenuRecipeStatus,
  useRecipeCost,
  useRecipesList,
  useUomConversions,
  useUoms,
  useUpsertIngredient,
  useUpsertRecipe,
  useUpsertUomConversion,
} from '@/features/recipes/hooks/useRecipesQueries'
import { fetchRecipe } from '@/features/recipes/api/recipes.api'
import type { Ingredient, RecipeLineInput, RecipeListItem } from '@/features/recipes/types'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'
import { useMemo, useState, type ReactNode } from 'react'

const TABS = ['coverage', 'ingredients', 'uom', 'recipes', 'cost'] as const
type Tab = (typeof TABS)[number]

export function RecipesPage() {
  const [tab, setTab] = useState<Tab>('coverage')

  return (
    <div className="space-y-6">
      <PageHeader title={t.recipes.title} description={t.recipes.subtitle} />

      <div
        role="tablist"
        className="border-border flex flex-wrap gap-1 border-b"
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
            {t.recipes.tabs[value]}
          </Button>
        ))}
      </div>

      {tab === 'coverage' ? <CoverageTab /> : null}
      {tab === 'ingredients' ? <IngredientsTab /> : null}
      {tab === 'uom' ? <UomTab /> : null}
      {tab === 'recipes' ? <RecipesTab /> : null}
      {tab === 'cost' ? <CostTab /> : null}
    </div>
  )
}

function CoverageTab() {
  const q = useCoverage()
  const status = useMenuRecipeStatus()
  if (q.isLoading || status.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.recipes.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )
  const d = q.data!
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label={t.recipes.coverage.total} value={String(d.menu_items_total)} />
        <Kpi label={t.recipes.coverage.withRecipe} value={String(d.with_recipe)} />
        <Kpi
          label={t.recipes.coverage.withoutRecipe}
          value={String(d.without_recipe)}
        />
        <Kpi
          label={t.recipes.coverage.pct}
          value={d.coverage_pct == null ? '—' : `${d.coverage_pct}%`}
        />
        <Kpi label={t.recipes.coverage.prep} value={String(d.prep_recipes_count)} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.recipes.coverage.withoutRecipe}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border max-h-80 divide-y overflow-auto text-sm">
            {(status.data ?? [])
              .filter((r) => !r.has_recipe)
              .map((r) => (
                <li key={r.menu_item_id} className="flex justify-between gap-2 py-2">
                  <span>{r.name}</span>
                  <span className="text-amber-700 text-xs font-medium">
                    {t.recipes.coverage.noRecipe}
                  </span>
                </li>
              ))}
            {(status.data ?? []).every((r) => r.has_recipe) ? (
              <li className="text-muted-foreground py-2">—</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function IngredientsTab() {
  const list = useIngredients()
  const uoms = useUoms()
  const upsert = useUpsertIngredient()
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [creating, setCreating] = useState(false)
  const blank = {
    name_ar: '',
    name_en: '',
    code: '',
    base_uom_id: '',
    standard_cost: 0,
    is_active: true,
  }
  const [form, setForm] = useState(blank)

  if (list.isLoading || uoms.isLoading) return <LoadingState />
  if (list.isError)
    return (
      <ErrorState
        description={
          list.error instanceof Error
            ? list.error.message
            : t.recipes.errors.generic
        }
        onRetry={() => void list.refetch()}
      />
    )

  const openCreate = () => {
    setEditing(null)
    setCreating(true)
    setForm({
      ...blank,
      base_uom_id: uoms.data?.[0]?.id ?? '',
    })
  }

  const openEdit = (ing: Ingredient) => {
    setCreating(false)
    setEditing(ing)
    setForm({
      name_ar: ing.name_ar,
      name_en: ing.name_en ?? '',
      code: ing.code ?? '',
      base_uom_id: ing.base_uom_id,
      standard_cost: Number(ing.standard_cost),
      is_active: ing.is_active,
    })
  }

  const save = async () => {
    await upsert.mutateAsync({
      id: editing?.id ?? null,
      ...form,
      standard_cost: Number(form.standard_cost),
    })
    setEditing(null)
    setCreating(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t.recipes.costMode.label}:{' '}
          <span className="text-foreground font-medium">
            {t.recipes.costMode.standard}
          </span>
        </p>
        <Button type="button" size="sm" onClick={openCreate}>
          {t.recipes.ingredients.add}
        </Button>
      </div>

      {(creating || editing) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editing
                ? t.recipes.ingredients.edit
                : t.recipes.ingredients.add}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label={t.recipes.ingredients.nameAr}>
              <Input
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
              />
            </Field>
            <Field label={t.recipes.ingredients.nameEn}>
              <Input
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
            </Field>
            <Field label={t.recipes.ingredients.code}>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
            <Field label={t.recipes.ingredients.baseUom}>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={form.base_uom_id}
                onChange={(e) =>
                  setForm({ ...form, base_uom_id: e.target.value })
                }
              >
                {(uoms.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name_ar} ({u.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.recipes.ingredients.standardCost}>
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={form.standard_cost}
                onChange={(e) =>
                  setForm({ ...form, standard_cost: Number(e.target.value) })
                }
              />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button
                type="button"
                onClick={() => void save()}
                disabled={upsert.isPending || !form.name_ar || !form.base_uom_id}
              >
                {t.recipes.ingredients.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null)
                  setCreating(false)
                }}
              >
                {t.recipes.actions.cancel}
              </Button>
              {upsert.isError ? (
                <span className="text-destructive text-sm">
                  {upsert.error instanceof Error
                    ? upsert.error.message
                    : t.recipes.errors.generic}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          {(list.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t.recipes.ingredients.empty}
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {(list.data ?? []).map((ing) => (
                <li
                  key={ing.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <p className="font-medium">{ing.name_ar}</p>
                    <p className="text-muted-foreground text-xs">
                      {t.recipes.costMode.standard} · {ing.base_uom_name_ar} ·{' '}
                      <span dir="ltr">{formatMoney(Number(ing.standard_cost))}</span>
                      {ing.code ? ` · ${ing.code}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(ing)}
                  >
                    {t.recipes.ingredients.edit}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function UomTab() {
  const uoms = useUoms()
  const conv = useUomConversions()
  const upsert = useUpsertUomConversion()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [factor, setFactor] = useState('1000')

  if (uoms.isLoading || conv.isLoading) return <LoadingState />

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.recipes.uom.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y text-sm">
            {(uoms.data ?? []).map((u) => (
              <li key={u.id} className="flex justify-between py-2">
                <span>
                  {u.name_ar}
                  {u.name_en ? ` · ${u.name_en}` : ''}
                </span>
                <span className="text-muted-foreground font-mono" dir="ltr">
                  {u.code}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.recipes.uom.conversions}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">{t.recipes.uom.hint}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">{t.recipes.uom.from}</option>
              {(uoms.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name_ar}
                </option>
              ))}
            </select>
            <select
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">{t.recipes.uom.to}</option>
              {(uoms.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name_ar}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min="0"
              step="any"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              placeholder={t.recipes.uom.factor}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!from || !to || upsert.isPending}
            onClick={() =>
              void upsert.mutateAsync({
                from_uom_id: from,
                to_uom_id: to,
                factor: Number(factor),
              })
            }
          >
            {t.recipes.uom.addConversion}
          </Button>
          <ul className="divide-border divide-y text-sm">
            {(conv.data ?? []).map((c) => (
              <li key={c.id} className="py-2" dir="ltr">
                1 {c.from_code} = {c.factor} {c.to_code}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function RecipesTab() {
  const recipes = useRecipesList()
  const ingredients = useIngredients()
  const uoms = useUoms()
  const menuStatus = useMenuRecipeStatus()
  const upsert = useUpsertRecipe()
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [nameAr, setNameAr] = useState('')
  const [menuItemId, setMenuItemId] = useState('')
  const [yieldQty, setYieldQty] = useState('1')
  const [yieldUom, setYieldUom] = useState('')
  const [wastePct, setWastePct] = useState('0')
  const [lines, setLines] = useState<RecipeLineInput[]>([
    { ingredient_id: '', qty: 1, uom_id: '' },
  ])

  const startCreate = () => {
    setEditId(null)
    setNameAr('')
    setMenuItemId('')
    setYieldQty('1')
    setYieldUom(uoms.data?.find((u) => u.code === 'portion')?.id ?? uoms.data?.[0]?.id ?? '')
    setWastePct('0')
    setLines([{ ingredient_id: '', qty: 1, uom_id: '' }])
    setOpen(true)
  }

  const startEdit = async (r: RecipeListItem) => {
    const full = await fetchRecipe(r.id)
    setEditId(full.id)
    setNameAr(full.name_ar)
    setMenuItemId(full.menu_item_id ?? '')
    setYieldQty(String(full.yield_qty))
    setYieldUom(full.yield_uom_id)
    setWastePct(String(full.waste_pct))
    setLines(
      (full.lines ?? []).map((l) => ({
        ingredient_id: l.ingredient_id,
        qty: Number(l.qty),
        uom_id: l.uom_id,
        sort_order: l.sort_order,
      })),
    )
    setOpen(true)
  }

  const save = async () => {
    const clean = lines.filter((l) => l.ingredient_id && l.uom_id && l.qty > 0)
    await upsert.mutateAsync({
      id: editId,
      menu_item_id: menuItemId || null,
      name_ar: nameAr,
      yield_qty: Number(yieldQty),
      yield_uom_id: yieldUom,
      waste_pct: Number(wastePct),
      lines: clean,
    })
    setOpen(false)
  }

  if (recipes.isLoading || ingredients.isLoading || uoms.isLoading)
    return <LoadingState />

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={startCreate}>
          {t.recipes.recipe.add}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {editId ? t.recipes.recipe.edit : t.recipes.recipe.add}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label={t.recipes.recipe.nameAr}>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label={t.recipes.recipe.menuItem}>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={menuItemId}
                onChange={(e) => setMenuItemId(e.target.value)}
              >
                <option value="">{t.recipes.recipe.none}</option>
                {(menuStatus.data ?? []).map((m) => (
                  <option key={m.menu_item_id} value={m.menu_item_id}>
                    {m.name}
                    {!m.has_recipe || m.recipe_id === editId
                      ? ''
                      : ` (${t.recipes.recipe.linked})`}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">
                {t.recipes.recipe.prepHint}
              </p>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t.recipes.recipe.yieldQty}>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={yieldQty}
                  onChange={(e) => setYieldQty(e.target.value)}
                />
              </Field>
              <Field label={t.recipes.recipe.yieldUom}>
                <select
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  value={yieldUom}
                  onChange={(e) => setYieldUom(e.target.value)}
                >
                  {(uoms.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_ar}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.recipes.recipe.wastePct}>
                <Input
                  type="number"
                  min="0"
                  max="99.9999"
                  step="any"
                  value={wastePct}
                  onChange={(e) => setWastePct(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t.recipes.recipe.lines}</p>
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]"
                >
                  <select
                    className="border-input bg-background h-10 rounded-md border px-2 text-sm"
                    value={line.ingredient_id}
                    onChange={(e) => {
                      const next = [...lines]
                      const ing = (ingredients.data ?? []).find(
                        (i) => i.id === e.target.value,
                      )
                      next[idx] = {
                        ...next[idx]!,
                        ingredient_id: e.target.value,
                        uom_id: ing?.base_uom_id ?? next[idx]!.uom_id,
                      }
                      setLines(next)
                    }}
                  >
                    <option value="">{t.recipes.recipe.ingredient}</option>
                    {(ingredients.data ?? [])
                      .filter((i) => i.is_active)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name_ar}
                        </option>
                      ))}
                  </select>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...lines]
                      next[idx] = {
                        ...next[idx]!,
                        qty: Number(e.target.value),
                      }
                      setLines(next)
                    }}
                  />
                  <select
                    className="border-input bg-background h-10 rounded-md border px-2 text-sm"
                    value={line.uom_id}
                    onChange={(e) => {
                      const next = [...lines]
                      next[idx] = { ...next[idx]!, uom_id: e.target.value }
                      setLines(next)
                    }}
                  >
                    <option value="">{t.recipes.recipe.uom}</option>
                    {(uoms.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_ar}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLines([
                    ...lines,
                    { ingredient_id: '', qty: 1, uom_id: '' },
                  ])
                }
              >
                {t.recipes.recipe.addLine}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                disabled={upsert.isPending || !nameAr || !yieldUom}
                onClick={() => void save()}
              >
                {t.recipes.recipe.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t.recipes.actions.cancel}
              </Button>
              {upsert.isError ? (
                <span className="text-destructive text-sm">
                  {upsert.error instanceof Error
                    ? upsert.error.message
                    : t.recipes.errors.generic}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-4">
          {(recipes.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t.recipes.recipe.empty}
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {(recipes.data ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <p className="font-medium">{r.name_ar}</p>
                    <p className="text-muted-foreground text-xs">
                      {r.is_prep
                        ? t.recipes.recipe.isPrep
                        : r.menu_item_name}{' '}
                      · Yield {r.yield_qty} {r.yield_uom_name_ar} ·{' '}
                      {t.recipes.recipe.wastePct} {r.waste_pct}% · {r.line_count}{' '}
                      {t.recipes.recipe.lines}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void startEdit(r)}
                  >
                    {t.recipes.recipe.edit}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CostTab() {
  const recipes = useRecipesList()
  const menuStatus = useMenuRecipeStatus()
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [menuItemId, setMenuItemId] = useState<string | null>(null)
  const byRecipe = useRecipeCost(recipeId)
  const byItem = useMenuItemCost(menuItemId)

  const breakdown = useMemo(() => {
    if (recipeId && byRecipe.data) return byRecipe.data
    if (menuItemId && byItem.data) return byItem.data
    return null
  }, [recipeId, menuItemId, byRecipe.data, byItem.data])

  const loading =
    (recipeId && byRecipe.isLoading) || (menuItemId && byItem.isLoading)
  const error =
    (recipeId && byRecipe.error) || (menuItemId && byItem.error) || null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.recipes.cost.pickRecipe}>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={recipeId ?? ''}
            onChange={(e) => {
              setRecipeId(e.target.value || null)
              setMenuItemId(null)
            }}
          >
            <option value="">—</option>
            {(recipes.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name_ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.recipes.cost.pickItem}>
          <select
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
            value={menuItemId ?? ''}
            onChange={(e) => {
              setMenuItemId(e.target.value || null)
              setRecipeId(null)
            }}
          >
            <option value="">—</option>
            {(menuStatus.data ?? []).map((m) => (
              <option key={m.menu_item_id} value={m.menu_item_id}>
                {m.name}
                {m.has_recipe ? '' : ` (${t.recipes.coverage.noRecipe})`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {loading ? <LoadingState /> : null}
      {error ? (
        <ErrorState
          description={
            error instanceof Error ? error.message : t.recipes.errors.generic
          }
        />
      ) : null}

      {breakdown && breakdown.has_recipe === false ? (
        <Card>
          <CardContent className="text-amber-800 pt-4 text-sm font-medium">
            {t.recipes.cost.noRecipe}
          </CardContent>
        </Card>
      ) : null}

      {breakdown && breakdown.lines ? (
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t.recipes.costMode.label}:{' '}
            <span className="text-foreground font-medium">
              {t.recipes.costMode.standard}
            </span>
            {' · '}
            {breakdown.recipe_name_ar}
          </p>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t.recipes.cost.breakdown}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y text-sm">
                {breakdown.lines.map((l) => (
                  <li
                    key={l.ingredient_id}
                    className="flex flex-wrap justify-between gap-2 py-2"
                  >
                    <span>
                      {l.ingredient_name_ar}
                      <span className="text-muted-foreground">
                        {' '}
                        · {l.qty} {l.uom_name_ar} (
                        {t.recipes.cost.qtyInBase} {l.qty_in_base}{' '}
                        {l.base_uom_code})
                      </span>
                    </span>
                    <span dir="ltr">{formatMoney(l.line_cost)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 pt-4 text-sm">
              <Row
                label={t.recipes.cost.ingredientsCost}
                value={formatMoney(breakdown.ingredients_cost)}
              />
              <Row
                label={`${t.recipes.cost.wasteCost} (${breakdown.waste_pct}%)`}
                value={formatMoney(breakdown.waste_cost)}
              />
              <Row
                label={t.recipes.cost.batchTotal}
                value={formatMoney(breakdown.total_batch_cost)}
              />
              <Row
                label={`${t.recipes.cost.unitCost} ÷ ${breakdown.yield_qty}`}
                value={formatMoney(breakdown.cost_per_yield_unit)}
              />
              {breakdown.sell_price != null ? (
                <>
                  <Row
                    label={t.recipes.cost.sellPrice}
                    value={formatMoney(breakdown.sell_price)}
                  />
                  <Row
                    label={t.recipes.cost.margin}
                    value={
                      breakdown.margin_amount == null
                        ? '—'
                        : formatMoney(breakdown.margin_amount)
                    }
                  />
                  <Row
                    label={t.recipes.cost.marginPct}
                    value={
                      breakdown.margin_pct == null
                        ? '—'
                        : `${breakdown.margin_pct}%`
                    }
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <p className="text-muted-foreground text-xs font-semibold">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" dir="ltr">
        {value}
      </p>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground text-xs font-semibold">
        {label}
      </span>
      {children}
    </label>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-dashed py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums" dir="ltr">
        {value}
      </span>
    </div>
  )
}
