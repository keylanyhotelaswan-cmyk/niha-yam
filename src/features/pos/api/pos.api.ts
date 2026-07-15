import { supabase } from '@/lib/supabase/client'
import { mapRpcError } from '@/shared/errors/rpc-error'
import { parseDiscountPermissions } from '@/shared/access/discountPermissions'
import { t } from '@/shared/i18n'
import type {
  FinalizeSaleResult,
  PosContext,
  PosMenu,
  SaleItemInput,
  TenderInput,
} from '@/features/pos/types'
import type { Database } from '@/types/database.generated'

type ErrorCode = keyof typeof t.pos.errors

function wrap(error: { message: string }): Error {
  return new Error(mapRpcError(error.message, t.pos.errors, t.pos.errors.generic))
}

export async function fetchPosMenu(): Promise<PosMenu> {
  const { data, error } = await supabase.rpc('list_menu_for_pos')
  if (error) throw wrap(error)
  return (data as unknown as PosMenu) ?? { favorites: [], categories: [] }
}

export async function fetchPosContext(): Promise<PosContext> {
  const { data, error } = await supabase.rpc('get_pos_context')
  if (error) throw wrap(error)
  const raw = (data as unknown as PosContext) ?? {
    open_shift: null,
    payment_methods: [],
    operational_treasuries: [],
    can_discount: false,
    can_open_shift: false,
  }
  if (raw.discount_permissions) {
    raw.discount_permissions = parseDiscountPermissions(raw.discount_permissions)
  }
  return raw
}

export async function finalizeSale(input: {
  items: SaleItemInput[]
  tenders: TenderInput[]
  discount?: { type: 'amount' | 'percent'; value: number; reason: string } | null
  orderNote?: string | null
  clientRequestId?: string | null
  orderType?: 'takeaway' | 'delivery' | 'dine_in'
  customerId?: string | null
  customerPhone?: string | null
  customerName?: string | null
  deliveryAddress?: string | null
  deliveryZone?: string | null
  deliveryNotes?: string | null
  dineInTableRef?: string | null
  deliveryDriverId?: string | null
}): Promise<FinalizeSaleResult> {
  const { data, error } = await supabase.rpc('finalize_sale', {
    p_items: input.items,
    p_tenders: input.tenders,
    p_discount: input.discount ?? null,
    p_order_note: input.orderNote ?? null,
    p_client_request_id: input.clientRequestId ?? null,
    p_order_type: input.orderType ?? 'takeaway',
    p_customer_id: input.customerId ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_customer_name: input.customerName ?? null,
    p_delivery_address: input.deliveryAddress ?? null,
    p_delivery_zone: input.deliveryZone ?? null,
    p_delivery_notes: input.deliveryNotes ?? null,
    p_dine_in_table_ref: input.dineInTableRef ?? null,
    p_delivery_driver_id: input.deliveryDriverId ?? null,
  })
  if (error) throw wrap(error)
  return data as unknown as FinalizeSaleResult
}

export type PosSearchResult = {
  orders: Array<{
    id: string
    reference: string
    customer_name: string | null
    payment_status: string
    order_type: string
    total: number
    created_at: string
  }>
  customers: Array<{
    id: string
    display_name: string
    primary_phone: string | null
    order_count?: number
  }>
  menu_items: Array<{
    id: string
    name: string
    sku: string | null
    base_price: number
  }>
}

export async function posSearch(
  query: string,
  limit = 15,
): Promise<PosSearchResult> {
  const { data, error } = await (
    supabase.rpc as (name: string, args?: Record<string, unknown>) => PromiseLike<{
      data: unknown
      error: { message: string } | null
    }>
  )('pos_search', {
    p_query: query,
    p_limit: limit,
  })
  if (error) throw wrap(error)
  return (data as unknown as PosSearchResult) ?? {
    orders: [],
    customers: [],
    menu_items: [],
  }
}

export async function pinLogin(pin: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('pos-pin-login', {
    body: { pin },
  })
  if (error) throw new Error(t.pos.pin.failed)

  const payload = data as {
    code?: string
    access_token?: string
    refresh_token?: string
  }
  if (payload.code) {
    const code = payload.code as ErrorCode
    const mapped = t.pos.errors[code] ?? t.pos.pin.invalid
    throw new Error(
      import.meta.env.DEV ? `${mapped} [DEV: ${payload.code}]` : mapped,
    )
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error(t.pos.pin.failed)
  }

  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  })
  if (sessionErr) throw new Error(t.pos.pin.failed)
}

/** Lock screen: verify PIN for the currently signed-in staff only. */
export async function verifyMyPin(pin: string): Promise<boolean> {
  const { data, error } = await (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )('verify_my_pin', { p_pin: pin })
  if (error) throw wrap(error)
  return Boolean(data)
}

export async function posOperationalTransfer(input: {
  sourceTreasuryId: string
  destTreasuryId: string
  amount: number
  reason?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('pos_operational_transfer', {
    p_source_treasury_id: input.sourceTreasuryId,
    p_dest_treasury_id: input.destTreasuryId,
    p_amount: input.amount,
    p_reason: input.reason ?? null,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function posRecordExpense(input: {
  amount: number
  category?: Database['public']['Enums']['expense_category']
  description?: string | null
  vendor?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('pos_record_expense', {
    p_amount: input.amount,
    p_category: input.category ?? 'petty_cash',
    p_description: input.description ?? null,
    p_vendor: input.vendor ?? null,
  })
  if (error) throw wrap(error)
  return data as string
}
