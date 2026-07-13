export type ReportMode = 'official' | 'operational' | 'ops'

export type ShiftListItem = {
  id: string
  reference: string
  status: string
  opened_at: string
  closed_at: string | null
  opened_by_name: string | null
}

export type PaymentMethodBreakdown = {
  payment_method_id: string
  name: string
  code: string
  count: number
  amount: number
}

export type OfficialSalesReport = {
  mode: ReportMode
  from: string
  to: string
  official_sales_total: number
  approved_collection_count: number
  by_payment_method: PaymentMethodBreakdown[]
  by_order_type: { order_type: string; order_count: number; amount: number }[]
  by_day: { day: string; count: number; amount: number }[]
  voided_orders_count: number
}

export type ExpensesReport = {
  mode: ReportMode
  from: string
  to: string
  executed_total: number
  executed_count: number
  pending_total: number
  pending_count: number
  by_category: { category: string; count: number; amount: number }[]
  rows: {
    id: string
    amount: number
    category: string
    status: string
    description: string | null
    created_at: string
    reference: string | null
    treasury_name: string | null
  }[]
}

export type TreasuryLedgerReport = {
  mode: ReportMode
  treasury_id: string
  treasury_name: string
  official_balance: number
  from: string
  to: string
  rows: {
    id: string
    amount: number
    source: string
    reference: string | null
    created_at: string
    created_by: string | null
  }[]
}

export type TodaySummary = {
  day: string
  official_sales_total: number
  by_payment_method: PaymentMethodBreakdown[]
  orders_count: number
  orders_by_type: { order_type: string; count: number; order_total_sum: number }[]
  voided_orders_count: number
  executed_expenses_total: number
  pending_collections_count: number
  pending_collections_amount: number
  pending_expenses_count: number
  pending_expenses_amount: number
  operational_drawer_balance: number | null
  open_shift: Record<string, unknown> | null
  alerts: { code: string; message: string; count?: number; amount?: number }[]
}

export type DateRange = { from: string; to: string }

export type OrdersSummaryReport = {
  mode: ReportMode
  from: string
  to: string
  active_orders_count: number
  active_orders_total: number
  voided_orders_count: number
  voided_orders_total: number
  by_order_type: { order_type: string; count: number; total: number }[]
  by_status: { status: string; count: number; total: number }[]
  by_payment_status: { payment_status: string; count: number; total: number }[]
}

export type DeliveryByDriverReport = {
  mode: ReportMode
  from: string
  to: string
  by_driver: {
    driver_id: string
    driver_name: string
    order_count: number
    order_total_sum: number
  }[]
  unassigned_delivery_count: number
}

export type ItemMixReport = {
  mode: ReportMode
  from: string
  to: string
  by_item: {
    item_name: string
    category_name: string
    qty_sold: number
    sales_total: number
    order_count: number
  }[]
  by_category: {
    category_name: string
    qty_sold: number
    sales_total: number
  }[]
}

export type PrintReliabilityReport = {
  mode: ReportMode
  from: string
  to: string
  jobs_total: number
  completed: number
  failed: number
  expired: number
  success_rate: number | null
  by_status: { status: string; count: number }[]
  by_kind: {
    kind: string
    count: number
    completed: number
    failed_or_expired: number
  }[]
}
