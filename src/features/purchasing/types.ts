export type PurchaseSourceKind = 'supplier' | 'direct'
export type PurchaseStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'reversed'

export type Supplier = {
  id: string
  code: string | null
  name_ar: string
  name_en: string | null
  phone: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type PurchaseLineInput = {
  ingredient_id: string
  qty: number
  uom_id: string
  unit_price: number
  notes?: string
}

export type PurchaseLine = {
  id: string
  ingredient_id: string
  ingredient_name_ar?: string
  qty: number
  uom_id: string
  unit_price: number
  line_total: number
  notes?: string | null
  stock_movement_id?: string | null
}

export type PurchaseSettlement = 'cash' | 'credit'

export type Purchase = {
  id: string
  reference: string
  source_kind: PurchaseSourceKind
  supplier_id: string | null
  supplier_name_ar?: string | null
  direct_label: string | null
  payment_method: PurchaseSettlement
  currency_code: 'EGP'
  treasury_id: string | null
  treasury_name?: string | null
  total_amount: number
  notes: string | null
  status: PurchaseStatus
  created_at: string
  executed_at: string | null
  reversed_at: string | null
  reversal_reason: string | null
  lines: PurchaseLine[]
}

export type PostDirectCashResult = {
  id: string
  reference: string
  total_amount: number
  status: string
  source_kind: PurchaseSourceKind
  payment_method?: PurchaseSettlement
  lines: PurchaseLine[]
}

export type SupplierBalance = {
  supplier_id: string
  supplier_name_ar: string
  open_balance: number
  currency_code: 'EGP'
}

export type SupplierStatementEntry = {
  at: string
  kind: string
  doc_id: string
  reference: string
  debit: number
  credit: number
  status: string
  running_balance: number
  label_ar: string
}

export type SupplierStatement = {
  supplier_id: string
  supplier_name_ar: string
  open_balance: number
  currency_code: 'EGP'
  entries: SupplierStatementEntry[]
}

export type SupplierPayment = {
  id: string
  reference: string
  supplier_id: string
  supplier_name_ar?: string
  treasury_id: string
  treasury_name?: string
  amount: number
  notes: string | null
  status: PurchaseStatus
  executed_at: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string
}
