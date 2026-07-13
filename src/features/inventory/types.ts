export type StockLocation = {
  id: string
  code: string
  name_ar: string
  is_default: boolean
  is_active: boolean
}

export type StockLevel = {
  ingredient_id: string
  name_ar: string
  code: string | null
  base_uom_code: string
  base_uom_name_ar: string
  on_hand: number
  reorder_level: number
  is_out: boolean
  is_low: boolean
  is_active: boolean
}

export type StockCardRow = {
  id: string
  moved_at: string
  movement_type: string
  direction: string
  reference: string
  qty_in: number
  qty_out: number
  balance_after: number
  reason: string | null
  source_type: string | null
  source_id: string | null
  reverses_movement_id: string | null
  created_by_name: string | null
  uom_code: string
}

export type StockCard = {
  ingredient_id: string
  ingredient_name_ar: string
  base_uom_name_ar: string
  location_id: string
  on_hand: number
  negative_stock_warning: boolean
  rows: StockCardRow[]
}

export type InventoryDashboard = {
  ingredients_total: number
  low_stock_count: number
  out_of_stock_count: number
  no_movement_14d_count: number
  variance_ingredients_count: number
  near_expiry_count: number | null
  near_expiry_enabled: boolean
  top_consumed: { name_ar: string; qty_base: number }[]
  top_waste: { name_ar: string; qty_base: number }[]
  recent_movements: {
    id: string
    moved_at: string
    movement_type: string
    reference: string
    ingredient_name_ar: string
    direction: string
    qty_base: number
    created_by_name: string | null
  }[]
  recent_counts: {
    id: string
    status: string
    counted_at: string | null
    created_at: string
  }[]
  signals: {
    low_stock: boolean
    out_of_stock: boolean
    no_movement: boolean
    high_waste: boolean
  }
}

export type PostMovementResult = {
  id: string
  reference: string
  on_hand_after: number
  negative_stock_warning: boolean
}

export type InvaMovementType =
  | 'opening'
  | 'receive'
  | 'issue'
  | 'waste'
  | 'adjustment'
