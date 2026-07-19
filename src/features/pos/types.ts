export type PosModifierOption = {
  id: string
  name: string
  price_delta: number
  is_default: boolean
}

export type PosModifierGroup = {
  id: string
  name: string
  min_selections: number
  max_selections: number
  options: PosModifierOption[]
}

export type PosMenuItem = {
  id: string
  name: string
  sku: string | null
  base_price: number
  sort_order: number
  category_id: string | null
  needs_kitchen: boolean
  needs_print: boolean
  accepts_modifiers: boolean
  allows_discounts: boolean
  is_open_price: boolean
  is_favorite: boolean
  modifier_groups: PosModifierGroup[]
}

export type PosCategory = {
  id: string
  name: string
  sort_order: number
  items: PosMenuItem[]
}

export type PosMenu = {
  favorites: PosMenuItem[]
  categories: PosCategory[]
}

export type PosPaymentMethod = {
  id: string
  name: string
  code: string
  treasury_id: string
  sort_order: number
}

export type PosDeliveryDriver = {
  id: string
  display_name: string
  phone: string | null
  is_active: boolean
  notes: string | null
}

export type PosOperationalTreasury = {
  id: string
  name: string
  code: string
  /** Operational (ledger + pending cash − pending expenses). */
  balance: number
  /** Approved ledger only — posts immediately on transfer. */
  approved_balance?: number
}

export type PosContext = {
  open_shift: Record<string, unknown> | null
  payment_methods: PosPaymentMethod[]
  delivery_drivers?: PosDeliveryDriver[]
  operational_treasuries: PosOperationalTreasury[]
  operational_drawer_balance?: number | null
  can_discount: boolean
  /** Full discount capability (role default or per-staff override). */
  discount_permissions?: import('@/shared/access/discountPermissions').DiscountPermissionConfig | null
  /** Independent operational goods-purchase capability (POS financial dialog). */
  can_operational_purchase?: boolean
  can_open_shift: boolean
  can_close_shift?: boolean
  can_approve_collections?: boolean
  can_manage_drivers?: boolean
  pending_handovers?: unknown[]
  pending_next_shift_handover?: import('@/features/treasury/api/treasury.api').PendingHandover | null
  has_pending_handover?: boolean
}

export type CartLine = {
  key: string
  menuItemId: string
  name: string
  sku: string | null
  unitPrice: number
  quantity: number
  modifierOptionIds: string[]
  modifierSummary: string
  openPrice?: number
  note?: string
  isOpenPrice: boolean
}

export type SaleItemInput = {
  menu_item_id: string
  quantity: number
  modifier_option_ids: string[]
  open_price?: number
  note?: string
}

export type TenderInput = {
  payment_method_id: string
  amount: number
}

export type FinalizeSaleResult = {
  order_id: string
  reference: string
  subtotal: number
  discount_amount: number
  total: number
  change: number
  kitchen_ticket_id: string | null
}
