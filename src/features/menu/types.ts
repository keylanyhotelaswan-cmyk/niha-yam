/** Menu domain shapes returned by the admin RPCs (`list_menu_admin`, `list_modifier_groups_admin`). */

export type MenuCategory = {
  id: string
  name: string
  sort_order: number
  show_in_pos: boolean
  is_active: boolean
}

export type MenuItem = {
  id: string
  category_id: string | null
  name: string
  sku: string | null
  base_price: number
  sort_order: number
  show_in_pos: boolean
  needs_kitchen: boolean
  needs_print: boolean
  accepts_modifiers: boolean
  allows_discounts: boolean
  is_open_price: boolean
  is_favorite: boolean
  is_active: boolean
  description: string | null
  modifier_group_ids: string[]
}

export type MenuAdminData = {
  categories: MenuCategory[]
  items: MenuItem[]
}

export type ModifierOption = {
  id: string
  name: string
  price_delta: number
  sort_order: number
  is_default: boolean
  is_active: boolean
}

export type ModifierGroup = {
  id: string
  name: string
  min_selections: number
  max_selections: number
  sort_order: number
  is_active: boolean
  options: ModifierOption[]
}

export type UpsertCategoryInput = {
  id: string | null
  name: string
  sortOrder: number
  showInPos: boolean
  isActive: boolean
}

export type UpsertItemInput = {
  id: string | null
  categoryId: string | null
  name: string
  sku: string | null
  basePrice: number
  sortOrder: number
  showInPos: boolean
  needsKitchen: boolean
  needsPrint: boolean
  acceptsModifiers: boolean
  allowsDiscounts: boolean
  isOpenPrice: boolean
  isFavorite: boolean
  description: string | null
  modifierGroupIds: string[]
}

export type UpsertModifierGroupInput = {
  id: string | null
  name: string
  minSelections: number
  maxSelections: number
  sortOrder: number
  isActive: boolean
}

export type UpsertModifierOptionInput = {
  id: string | null
  groupId: string
  name: string
  priceDelta: number
  sortOrder: number
  isDefault: boolean
  isActive: boolean
}
