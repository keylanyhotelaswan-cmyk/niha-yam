import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  CoverageDashboard,
  Ingredient,
  MenuRecipeStatus,
  RecipeCostBreakdown,
  RecipeLineInput,
  RecipeListItem,
  Uom,
  UomConversion,
} from '@/features/recipes/types'

type ErrorCode = keyof typeof t.recipes.errors

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.recipes.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.recipes.errors[code] : t.recipes.errors.generic
}

function wrap(error: { message: string }): Error {
  return new Error(rpcErrorMessage(error.message))
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

export async function fetchUoms(): Promise<Uom[]> {
  // Prefer bootstrap (volatile seed) then list; falls back to list if bootstrap missing.
  const boot = await rpc('rc_bootstrap_uoms')
  if (!boot.error) return (boot.data as Uom[]) ?? []
  const { data, error } = await rpc('list_uoms')
  if (error) throw wrap(error)
  return (data as Uom[]) ?? []
}

export async function fetchUomConversions(): Promise<UomConversion[]> {
  const { data, error } = await rpc('list_uom_conversions')
  if (error) throw wrap(error)
  return (data as UomConversion[]) ?? []
}

export async function upsertUomConversion(input: {
  from_uom_id: string
  to_uom_id: string
  factor: number
}): Promise<{ id: string }> {
  const { data, error } = await rpc('upsert_uom_conversion', {
    p_from_uom_id: input.from_uom_id,
    p_to_uom_id: input.to_uom_id,
    p_factor: input.factor,
  })
  if (error) throw wrap(error)
  return data as { id: string }
}

export async function fetchIngredients(
  activeOnly = false,
): Promise<Ingredient[]> {
  const { data, error } = await rpc('list_ingredients', {
    p_active_only: activeOnly,
  })
  if (error) throw wrap(error)
  return (data as Ingredient[]) ?? []
}

export async function upsertIngredient(input: {
  id?: string | null
  name_ar: string
  name_en?: string
  code?: string
  base_uom_id: string
  standard_cost: number
  is_active?: boolean
}): Promise<{ id: string }> {
  const { data, error } = await rpc('upsert_ingredient', {
    p_id: input.id ?? null,
    p_name_ar: input.name_ar,
    p_name_en: input.name_en ?? null,
    p_code: input.code ?? null,
    p_base_uom_id: input.base_uom_id,
    p_standard_cost: input.standard_cost,
    p_is_active: input.is_active ?? true,
  })
  if (error) throw wrap(error)
  return data as { id: string }
}

export async function fetchRecipe(recipeId: string): Promise<{
  id: string
  menu_item_id: string | null
  name_ar: string
  name_en: string | null
  yield_qty: number
  yield_uom_id: string
  waste_pct: number
  is_active: boolean
  lines: {
    ingredient_id: string
    qty: number
    uom_id: string
    sort_order: number
  }[]
}> {
  const { data, error } = await rpc('get_recipe', { p_recipe_id: recipeId })
  if (error) throw wrap(error)
  return data as {
    id: string
    menu_item_id: string | null
    name_ar: string
    name_en: string | null
    yield_qty: number
    yield_uom_id: string
    waste_pct: number
    is_active: boolean
    lines: {
      ingredient_id: string
      qty: number
      uom_id: string
      sort_order: number
    }[]
  }
}

export async function fetchRecipes(
  activeOnly = false,
): Promise<RecipeListItem[]> {
  const { data, error } = await rpc('list_recipes', {
    p_active_only: activeOnly,
  })
  if (error) throw wrap(error)
  return (data as RecipeListItem[]) ?? []
}

export async function upsertRecipe(input: {
  id?: string | null
  menu_item_id?: string | null
  name_ar: string
  name_en?: string
  yield_qty: number
  yield_uom_id: string
  waste_pct: number
  is_active?: boolean
  lines: RecipeLineInput[]
}): Promise<{ id: string }> {
  const { data, error } = await rpc('upsert_recipe', {
    p_id: input.id ?? null,
    p_menu_item_id: input.menu_item_id ?? null,
    p_name_ar: input.name_ar,
    p_name_en: input.name_en ?? null,
    p_yield_qty: input.yield_qty,
    p_yield_uom_id: input.yield_uom_id,
    p_waste_pct: input.waste_pct,
    p_is_active: input.is_active ?? true,
    p_lines: input.lines,
  })
  if (error) throw wrap(error)
  return data as { id: string }
}

export async function fetchCoverage(): Promise<CoverageDashboard> {
  const { data, error } = await rpc('recipes_coverage_dashboard')
  if (error) throw wrap(error)
  return data as CoverageDashboard
}

export async function fetchMenuRecipeStatus(): Promise<MenuRecipeStatus[]> {
  const { data, error } = await rpc('list_menu_items_recipe_status')
  if (error) throw wrap(error)
  return (data as MenuRecipeStatus[]) ?? []
}

export async function fetchRecipeCost(
  recipeId: string,
): Promise<RecipeCostBreakdown> {
  const { data, error } = await rpc('compute_recipe_cost', {
    p_recipe_id: recipeId,
  })
  if (error) throw wrap(error)
  return data as RecipeCostBreakdown
}

export async function fetchMenuItemCost(
  menuItemId: string,
): Promise<RecipeCostBreakdown> {
  const { data, error } = await rpc('compute_menu_item_cost', {
    p_menu_item_id: menuItemId,
  })
  if (error) throw wrap(error)
  return data as RecipeCostBreakdown
}
