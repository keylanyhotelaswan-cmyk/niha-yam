import type { Database } from '@/types/database.generated'

export type FinStatus = Database['public']['Enums']['fin_status']
export type TreasuryType = Database['public']['Enums']['treasury_type']
export type MovementSource = Database['public']['Enums']['movement_source']
export type ExpenseCategory = Database['public']['Enums']['expense_category']

export type TreasuryRow = Database['public']['Tables']['treasuries']['Row']
export type PaymentMethodRow =
  Database['public']['Tables']['payment_methods']['Row']
export type TransferRow =
  Database['public']['Tables']['treasury_transfers']['Row']
export type AdjustmentRow =
  Database['public']['Tables']['treasury_adjustments']['Row']
export type ExpenseRow = Database['public']['Tables']['expenses']['Row']

/** Computed per-treasury report from `get_treasury_balances` (no summary tables). */
export type TreasuryBalance = {
  id: string
  name: string
  type: TreasuryType
  is_shift_drawer: boolean
  is_active: boolean
  sort_order: number
  balance: number
  total_in: number
  total_out: number
  movement_count: number
}

/** Administrative liquidity split on Main cash (not a new treasury). */
export type LiquiditySnapshot = {
  treasury_id: string | null
  main_balance: number
  operating_balance: number
  reserved_balance: number
  operating_pct: number
  reserved_pct: number
  currency_code: 'EGP'
  note_ar: string
}

export type SmartShiftSheet = {
  shift: {
    id: string
    reference: string
    status: string
    opened_at: string
    closed_at: string | null
    duration_minutes: number
    opened_by_name?: string | null
    closed_by_name?: string | null
    actual_cash_count?: number | null
    difference_reason?: string | null
    notes?: string | null
  }
  report: Record<string, unknown>
  collections: {
    total_collected?: number
    by_payment_method?: Array<{
      payment_method_id?: string
      name: string
      amount: number
    }>
  }
  handover: {
    id: string
    reference: string
    kind: string
    amount: number
    status: string
    review_status: string
    review_notes?: string | null
    reviewed_at?: string | null
  } | null
  expenses: Array<{
    reference: string
    amount: number
    category: string
    description?: string | null
    vendor?: string | null
    status: string
    created_at?: string
  }>
  purchases: Array<{
    reference: string
    total_amount: number
    payment_method: string
    source_kind: string
    direct_label?: string | null
    supplier_name_ar?: string | null
    status: string
    lines?: Array<{
      ingredient_name_ar: string
      qty: number
      unit_price: number
      line_total: number
    }>
  }>
  supplier_payments: Array<{
    reference: string
    amount: number
    supplier_name_ar: string
    status: string
  }>
  transfers: Array<{
    reference: string
    amount: number
    is_cash_drop: boolean
    reason?: string | null
    status: string
  }>
  top_items: Array<{ name_ar: string; qty: number; sales: number }>
  cancelled_orders: number
  orders_count?: number
  sales_total?: number
  discounts_total: number
  ops_summary?: {
    income: number
    expenses: number
    purchases_cash: number
    supplier_payments: number
    transfers_out: number
    drawer_remaining: number
  }
  summary_ar?: { title?: string; review_only_note?: string }
}

export type LedgerEntry = {
  id: string
  amount: number
  source: MovementSource
  reference: string | null
  created_at: string
  created_by: string | null
}

/** Full ledger-computed shift report (from `get_shift_report`/`get_open_shift`). */
export type ShiftReport = {
  id: string
  reference: string
  status: 'open' | 'closed'
  opened_at: string
  opened_by: string | null
  closed_at: string | null
  actual_cash: number | null
  difference_reason: string | null
  notes: string | null
  opening_balance: number
  opening_float: number
  cash_sales: number
  cash_drops: number
  expenses: number
  deposits: number
  withdrawals: number
  refunds: number
  transfers_in: number
  expected_cash: number
  variance: number
  /** Cumulative physical drawer (for close-count). Open-shift KPIs use operational_drawer_balance. */
  physical_drawer_balance?: number | null
  operational_drawer_balance?: number | null
  approved_revenue?: number
  pending_collections_count?: number
  pending_collections_amount?: number
  pending_collections_summary?: {
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
  pending_by_payment_method?: Array<{
    payment_method_id: string
    name: string
    code: string
    count: number
    amount: number
  }>
  pending_expenses_count?: number
  pending_expenses_amount?: number
  pending_expenses_summary?: {
    count: number
    amount: number
    by_category: Array<{
      category: string
      count: number
      amount: number
    }>
  }
}

/** The open shift is just its report (or null when none is open). */
export type OpenShift = ShiftReport

export type CreateTransferInput = {
  sourceTreasuryId: string
  destTreasuryId: string
  amount: number
  reason: string | null
}

export type CreateExpenseInput = {
  treasuryId: string
  category: ExpenseCategory
  amount: number
  description: string | null
  vendor: string | null
}

export type CreateAdjustmentInput = {
  treasuryId: string
  kind: 'deposit' | 'withdrawal'
  amount: number
  reason: string | null
}

export type UpsertTreasuryInput = {
  id: string | null
  name: string
  type: TreasuryType
  sortOrder: number
}

export type HandoverKind = 'to_main' | 'to_next_shift'

export type HandoverSummary = {
  id: string
  reference: string
  kind: HandoverKind | string
  amount: number
  status: string
  created_at: string
  received_at: string | null
  rejected_at?: string | null
  rejection_reason: string | null
  cashier_name: string | null
  received_by_name: string | null
  rejected_by_name?: string | null
  target_shift_id?: string | null
  transfer_id?: string | null
  target_shift_reference?: string | null
  source_variance?: number | null
  receiver_opening_float?: number | null
  receiver_starting_trust?: number | null
  received_actual_cash?: number | null
  receive_variance?: number | null
}

export type ShiftArchiveListItem = {
  id: string
  reference: string
  status: string
  opened_at: string
  closed_at: string | null
  actual_cash_count: number | null
  opened_by_name: string | null
  closed_by_name: string | null
  handovers: HandoverSummary[]
}

export type ShiftArchiveDetail = {
  report: ShiftReport
  handovers: HandoverSummary[]
  orders: Array<{
    id: string
    order_number: string | number
    order_type: string
    payment_status: string
    fulfillment_status: string
    total: number
    created_at: string
  }>
}
