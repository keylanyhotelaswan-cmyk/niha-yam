export type Uom = {
  id: string
  code: string
  name_ar: string
  name_en: string | null
  is_active: boolean
}

export type UomConversion = {
  id: string
  from_uom_id: string
  to_uom_id: string
  factor: number
  from_code: string
  to_code: string
  from_name_ar: string
  to_name_ar: string
}

export type Ingredient = {
  id: string
  name_ar: string
  name_en: string | null
  code: string | null
  base_uom_id: string
  base_uom_code: string
  base_uom_name_ar: string
  is_active: boolean
  cost_mode: 'standard' | 'last_purchase' | 'moving_average'
  standard_cost: number
  updated_at: string
}

export type RecipeListItem = {
  id: string
  menu_item_id: string | null
  menu_item_name: string | null
  name_ar: string
  name_en: string | null
  yield_qty: number
  yield_uom_id: string
  yield_uom_code: string
  yield_uom_name_ar: string
  waste_pct: number
  is_active: boolean
  is_prep: boolean
  line_count: number
}

export type RecipeLineInput = {
  ingredient_id: string
  qty: number
  uom_id: string
  sort_order?: number
}

export type CoverageDashboard = {
  menu_items_total: number
  with_recipe: number
  without_recipe: number
  coverage_pct: number | null
  prep_recipes_count: number
}

export type MenuRecipeStatus = {
  menu_item_id: string
  name: string
  base_price: number
  is_active: boolean
  recipe_id: string | null
  has_recipe: boolean
}

export type CostLine = {
  ingredient_id: string
  ingredient_name_ar: string
  cost_mode: string
  qty: number
  uom_code: string
  uom_name_ar: string
  qty_in_base: number
  base_uom_code: string
  unit_cost: number
  line_cost: number
}

export type RecipeCostBreakdown = {
  recipe_id: string
  menu_item_id: string | null
  menu_item_name: string | null
  recipe_name_ar: string
  is_prep: boolean
  cost_mode_note: string
  lines: CostLine[]
  ingredients_cost: number
  waste_pct: number
  waste_cost: number
  total_batch_cost: number
  yield_qty: number
  cost_per_yield_unit: number
  sell_price: number | null
  margin_amount: number | null
  margin_pct: number | null
  has_recipe?: boolean
  message?: string
}
