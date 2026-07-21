import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  MenuAdminData,
  ModifierGroup,
  UpsertCategoryInput,
  UpsertItemInput,
  UpsertModifierGroupInput,
  UpsertModifierOptionInput,
} from '@/features/menu/types'

type MenuErrorCode = keyof typeof t.menu.errors

function messageForCode(code: string): string {
  const known = t.menu.errors as Record<string, string>
  return known[code] ?? t.menu.errors.generic
}

/** RPC errors surface the code inside the message; find the first known one. */
function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.menu.errors) as MenuErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? messageForCode(code) : t.menu.errors.generic
}

function wrap(error: { message: string }): Error {
  return new Error(rpcErrorMessage(error.message))
}

// Reads --------------------------------------------------------------------
export async function fetchMenuAdmin(): Promise<MenuAdminData> {
  const { data, error } = await supabase.rpc('list_menu_admin')
  if (error) throw error
  return (data as unknown as MenuAdminData) ?? { categories: [], items: [] }
}

export async function fetchModifierGroups(): Promise<ModifierGroup[]> {
  const { data, error } = await supabase.rpc('list_modifier_groups_admin')
  if (error) throw error
  return (data as unknown as ModifierGroup[]) ?? []
}

// Categories ---------------------------------------------------------------
export async function upsertCategory(
  input: UpsertCategoryInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_menu_category', {
    p_id: input.id ?? '',
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_show_in_pos: input.showInPos,
    p_is_active: input.isActive,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function setCategoryStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_menu_category_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

// Items --------------------------------------------------------------------
export async function upsertItem(input: UpsertItemInput): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_menu_item', {
    p_id: input.id ?? '',
    p_category_id: input.categoryId ?? '',
    p_name: input.name,
    p_sku: input.sku ?? '',
    p_base_price: input.basePrice,
    p_sort_order: input.sortOrder,
    p_show_in_pos: input.showInPos,
    p_needs_kitchen: input.needsKitchen,
    p_needs_print: input.needsPrint,
    p_accepts_modifiers: input.acceptsModifiers,
    p_allows_discounts: input.allowsDiscounts,
    p_is_open_price: input.isOpenPrice,
    p_is_favorite: input.isFavorite,
    p_description: input.description ?? '',
  })
  if (error) throw wrap(error)
  const itemId = data as string

  // Modifier links only matter when the item accepts modifiers.
  if (input.acceptsModifiers) {
    await linkItemModifierGroups(itemId, input.modifierGroupIds)
  } else if (input.id) {
    // Editing an item that no longer accepts modifiers: clear its links.
    await linkItemModifierGroups(itemId, [])
  }
  return itemId
}

export async function setItemStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_menu_item_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

export async function linkItemModifierGroups(
  itemId: string,
  groupIds: string[],
): Promise<void> {
  const links = groupIds.map((id, index) => ({
    modifier_group_id: id,
    sort_order: index,
  }))
  const { error } = await supabase.rpc('link_item_modifier_groups', {
    p_item_id: itemId,
    p_links: links,
  })
  if (error) throw wrap(error)
}

// Modifier groups ----------------------------------------------------------
export async function upsertModifierGroup(
  input: UpsertModifierGroupInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_modifier_group', {
    p_id: input.id ?? '',
    p_name: input.name,
    p_min_selections: input.minSelections,
    p_max_selections: input.maxSelections,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function setModifierGroupStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_modifier_group_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

// Modifier options ---------------------------------------------------------
export async function upsertModifierOption(
  input: UpsertModifierOptionInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_modifier_option', {
    p_id: input.id ?? '',
    p_group_id: input.groupId,
    p_name: input.name,
    p_price_delta: input.priceDelta,
    p_sort_order: input.sortOrder,
    p_is_default: input.isDefault,
    p_is_active: input.isActive,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function setModifierOptionStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_modifier_option_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}
