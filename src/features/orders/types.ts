export type OrderPaymentStatus = 'unpaid' | 'partial' | 'paid'
export type OrderFulfillmentStatus =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled'
export type OrderPrintStatus = 'not_needed' | 'pending' | 'done' | 'failed'
export type PosOrderType = 'takeaway' | 'delivery' | 'dine_in'
export type CollectionStatus = 'pending' | 'approved' | 'rejected' | 'reversed'

export type PaymentBreakdownRow = {
  payment_method_id: string
  code: string
  name: string
  amount: number
}

export type OrderListItem = {
  id: string
  reference: string
  order_type: PosOrderType
  payment_status: OrderPaymentStatus
  fulfillment_status: OrderFulfillmentStatus
  print_status: OrderPrintStatus
  total: number
  order_total?: number
  collected_amount?: number
  remaining_amount?: number
  requires_review?: boolean
  review_reason?: string | null
  review_flagged_at?: string | null
  review_flagged_by_name?: string | null
  has_approved_collection?: boolean
  created_at: string
  created_by: string | null
  created_by_name?: string | null
  shift_id?: string | null
  customer_name: string | null
  pending_collections: number
  payment_breakdown?: PaymentBreakdownRow[]
  cancel_reason?: string | null
  cancelled_at?: string | null
  cancelled_by_name?: string | null
  reversed_collections_count?: number
}

export type OrderMoney = {
  order_total: number
  collected_amount: number
  remaining_amount: number
  payment_status: OrderPaymentStatus
  pending_collections_count: number
  approved_collections_count: number
  has_approved_collection: boolean
  over_collected_amount: number
}

export type OrderTimelineEvent = {
  id: string
  event_type: string
  label?: string
  actor_id: string | null
  entity_type: string | null
  entity_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

export type OrderCollection = {
  id: string
  reference: string
  amount: number
  change_given: number
  net_amount: number | null
  collection_status: CollectionStatus
  payment_method_id: string
  payment_method_code?: string
  payment_method_name?: string
  created_at: string
  approved_at: string | null
  rejection_reason: string | null
  reversal_reason?: string | null
}

export type OrderDetail = {
  order: {
    id: string
    reference: string
    order_type: PosOrderType
    payment_status: OrderPaymentStatus
    fulfillment_status: OrderFulfillmentStatus
    print_status: OrderPrintStatus
    status: string
    subtotal: number
    discount_amount: number
    discount_type?: 'amount' | 'percent' | null
    discount_value?: number | null
    discount_reason?: string | null
    total: number
    order_note: string | null
    customer_id: string | null
    delivery_name: string | null
    delivery_phone: string | null
    delivery_address: string | null
    delivery_zone: string | null
    dine_in_table_ref?: string | null
    delivery_driver_id?: string | null
    delivery_driver_name?: string | null
    created_by: string | null
    cashier_name?: string | null
    created_by_name?: string | null
    created_at: string
    last_edited_by?: string | null
    last_edited_by_name?: string | null
    last_edited_at?: string | null
    collected_by?: string | null
    collected_by_name?: string | null
    collected_at?: string | null
    shift_id?: string | null
    requires_review?: boolean
    review_reason?: string | null
    review_flagged_at?: string | null
    review_flagged_by_name?: string | null
    can_free_edit?: boolean
    cancel_reason?: string | null
    cancelled_at?: string | null
    cancelled_by_name?: string | null
  }
  money?: OrderMoney
  items: Array<{
    id: string
    name: string
    quantity: number
    unit_price: number
    line_total: number
    line_note: string | null
    menu_item_id?: string | null
  }>
  collections: OrderCollection[]
  payment_breakdown?: PaymentBreakdownRow[]
  timeline: OrderTimelineEvent[]
}

export type ReviewQueueItem = {
  id: string
  reference: string
  cashier_id: string | null
  cashier_name: string | null
  review_reason: string | null
  requires_review: boolean
  money: OrderMoney
  flagged_at?: string | null
  flagged_by_name?: string | null
  last_edit_at: string | null
  financial_delta: number | null
  created_at: string
}

export type PendingCollectionRow = {
  id: string
  reference: string
  order_id: string
  order_reference: string
  amount: number
  change_given: number
  net_amount: number
  payment_method: string
  payment_method_code: string
  cashier_id: string | null
  customer_name: string | null
  created_at: string
}

export type PendingSummary = {
  count: number
  amount: number
  by_payment_method: Array<{
    payment_method_id: string
    name: string
    code: string
    count: number
    amount: number
  }>
}

export type PendingExpenseRow = {
  id: string
  reference: string
  amount: number
  category: string
  description: string | null
  vendor: string | null
  created_by: string | null
  created_at: string
}

export type PendingExpensesSummary = {
  count: number
  amount: number
  by_category: Array<{
    category: string
    count: number
    amount: number
  }>
}

export type ApprovePendingResult = {
  approved_count: number
  approved_expenses_count: number
}
