import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  InventoryDashboard,
  InvaMovementType,
  PostMovementResult,
  StockCard,
  StockLevel,
  StockLocation,
} from '@/features/inventory/types'

type ErrorCode = keyof typeof t.inventory.errors

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.inventory.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.inventory.errors[code] : t.inventory.errors.generic
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

export async function fetchInvLocations(): Promise<StockLocation[]> {
  const { data, error } = await rpc('inv_list_locations')
  if (error) throw wrap(error)
  return (data as StockLocation[]) ?? []
}

export async function fetchStockLevels(): Promise<StockLevel[]> {
  const { data, error } = await rpc('inv_list_stock_levels')
  if (error) throw wrap(error)
  return (data as StockLevel[]) ?? []
}

export async function fetchInventoryDashboard(): Promise<InventoryDashboard> {
  const { data, error } = await rpc('inv_dashboard')
  if (error) throw wrap(error)
  return data as InventoryDashboard
}

export async function fetchStockCard(
  ingredientId: string,
): Promise<StockCard> {
  const { data, error } = await rpc('inv_get_stock_card', {
    p_ingredient_id: ingredientId,
    p_location_id: null,
    p_limit: 200,
  })
  if (error) throw wrap(error)
  return data as StockCard
}

export async function postStockMovement(input: {
  ingredient_id: string
  movement_type: InvaMovementType
  qty: number
  uom_id: string
  reason?: string
  direction?: 'in' | 'out'
}): Promise<PostMovementResult> {
  const { data, error } = await rpc('inv_post_movement', {
    p_ingredient_id: input.ingredient_id,
    p_movement_type: input.movement_type,
    p_qty: input.qty,
    p_uom_id: input.uom_id,
    p_location_id: null,
    p_reason: input.reason ?? null,
    p_lot_id: null,
    p_source_type: null,
    p_source_id: null,
    p_direction: input.direction ?? null,
    p_reference: null,
  })
  if (error) throw wrap(error)
  return data as PostMovementResult
}

export async function reverseStockMovement(
  movementId: string,
  reason?: string,
): Promise<PostMovementResult & { reverses_movement_id: string }> {
  const { data, error } = await rpc('inv_reverse_movement', {
    p_movement_id: movementId,
    p_reason: reason ?? null,
  })
  if (error) throw wrap(error)
  return data as PostMovementResult & { reverses_movement_id: string }
}

export async function upsertStockSettings(
  ingredientId: string,
  reorderLevel: number,
): Promise<void> {
  const { error } = await rpc('inv_upsert_stock_settings', {
    p_ingredient_id: ingredientId,
    p_reorder_level: reorderLevel,
  })
  if (error) throw wrap(error)
}
