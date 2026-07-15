import { supabase } from '@/lib/supabase/client'
import { mapRpcError } from '@/shared/errors/rpc-error'
import { t } from '@/shared/i18n'
import type { DiscountPayload } from '@/shared/access/discountPermissions'
import type { Database } from '@/types/database.generated'
import type {
  ApprovePendingResult,
  OrderDetail,
  OrderListItem,
  PendingCollectionRow,
  PendingExpenseRow,
  PendingExpensesSummary,
  PendingSummary,
  ReviewQueueItem,
} from '@/features/orders/types'
import type { DeliveryDriver } from '@/features/drivers/types'
import type { PosSearchResult } from '@/features/pos/api/pos.api'
import type { SaleItemInput, TenderInput } from '@/features/pos/types'

type FulfillmentStatus = Database['public']['Enums']['order_fulfillment_status']
type PosOrderType = Database['public']['Enums']['pos_order_type']

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (name: string, args?: Record<string, unknown>) => PromiseLike<{
      data: unknown
      error: { message: string } | null
    }>
  )(fn, args)

function wrap(error: { message: string }): Error {
  return new Error(
    mapRpcError(error.message, t.orders.errors, t.orders.errors.generic),
  )
}

export async function fetchOrdersForPos(filters?: {
  date?: string
  paymentStatus?: string
  fulfillmentStatus?: string
  orderType?: string
  search?: string
  pendingOnly?: boolean
  shiftId?: string
  hubOnly?: boolean
}): Promise<OrderListItem[]> {
  const { data, error } = await rpc('list_orders_for_pos', {
    p_date: filters?.date ?? undefined,
    p_payment_status: filters?.paymentStatus ?? null,
    p_fulfillment_status: filters?.fulfillmentStatus ?? null,
    p_order_type: filters?.orderType ?? null,
    p_search: filters?.search ?? null,
    p_pending_collections_only: filters?.pendingOnly ?? false,
    p_shift_id: filters?.shiftId ?? null,
    p_hub_only: filters?.hubOnly ?? false,
  })
  if (error) throw wrap(error)
  return (data as OrderListItem[]) ?? []
}

export async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
  const { data, error } = await rpc('get_order_detail', {
    p_order_id: orderId,
  })
  if (error) throw wrap(error)
  return data as OrderDetail
}

export async function createUnpaidOrder(input: {
  items: SaleItemInput[]
  orderType?: PosOrderType
  customerId?: string | null
  customerPhone?: string | null
  customerName?: string | null
  deliveryAddress?: string | null
  deliveryZone?: string | null
  deliveryNotes?: string | null
  orderNote?: string | null
  dineInTableRef?: string | null
  deliveryDriverId?: string | null
  discount?: DiscountPayload
}): Promise<{ order_id: string; reference: string; money: unknown }> {
  const { data, error } = await rpc('create_unpaid_order', {
    p_items: input.items,
    p_order_type: input.orderType ?? 'takeaway',
    p_customer_id: input.customerId ?? null,
    p_customer_phone: input.customerPhone ?? null,
    p_customer_name: input.customerName ?? null,
    p_delivery_address: input.deliveryAddress ?? null,
    p_delivery_zone: input.deliveryZone ?? null,
    p_delivery_notes: input.deliveryNotes ?? null,
    p_order_note: input.orderNote ?? null,
    p_dine_in_table_ref: input.dineInTableRef ?? null,
    p_delivery_driver_id: input.deliveryDriverId ?? null,
  })
  if (error) throw wrap(error)
  const result = data as { order_id: string; reference: string; money: unknown }
  if (input.discount !== undefined && input.discount !== null) {
    const { error: discErr } = await rpc('apply_order_discount', {
      p_order_id: result.order_id,
      p_discount: input.discount,
    })
    if (discErr) throw wrap(discErr)
  }
  return result
}

export async function editPendingOrder(input: {
  orderId: string
  items: SaleItemInput[]
  customerPhone?: string | null
  customerName?: string | null
  tenders?: TenderInput[] | null
  orderNote?: string | null
  discount?: DiscountPayload | undefined
}): Promise<{ order_id: string; money: unknown; requires_review: boolean }> {
  const { data, error } = await rpc('edit_pending_order', {
    p_order_id: input.orderId,
    p_items: input.items,
    p_customer_phone: input.customerPhone ?? null,
    p_customer_name: input.customerName ?? null,
    p_tenders: input.tenders ?? null,
    p_order_note: input.orderNote ?? null,
  })
  if (error) throw wrap(error)
  if (input.discount !== undefined) {
    const { error: discErr } = await rpc('apply_order_discount', {
      p_order_id: input.orderId,
      p_discount: input.discount,
    })
    if (discErr) throw wrap(discErr)
  }
  return data as {
    order_id: string
    money: unknown
    requires_review: boolean
  }
}

export async function collectRemaining(
  orderId: string,
  tenders: TenderInput[],
): Promise<unknown> {
  const { data, error } = await rpc('collect_remaining', {
    p_order_id: orderId,
    p_tenders: tenders,
  })
  if (error) throw wrap(error)
  return data
}

export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  const { data, error } = await rpc('list_orders_requiring_review', {})
  if (error) throw wrap(error)
  return (data as ReviewQueueItem[]) ?? []
}

export async function clearOrderReview(orderId: string): Promise<void> {
  const { error } = await rpc('clear_order_review', { p_order_id: orderId })
  if (error) throw wrap(error)
}

export async function approvePendingForShift(
  shiftId: string,
): Promise<ApprovePendingResult> {
  const { data, error } = await rpc('approve_pending_for_shift', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  const row = data as {
    approved_count?: number
    approved_expenses_count?: number
  } | null
  return {
    approved_count: row?.approved_count ?? 0,
    approved_expenses_count: row?.approved_expenses_count ?? 0,
  }
}

export async function rejectPendingForShift(
  shiftId: string,
  reason: string,
): Promise<{ rejected_count: number; rejected_expenses_count: number }> {
  const { data, error } = await rpc('reject_pending_for_shift', {
    p_shift_id: shiftId,
    p_reason: reason,
  })
  if (error) throw wrap(error)
  const row = data as {
    rejected_count?: number
    rejected_expenses_count?: number
  } | null
  return {
    rejected_count: row?.rejected_count ?? 0,
    rejected_expenses_count: row?.rejected_expenses_count ?? 0,
  }
}

export async function approveCollection(id: string): Promise<void> {
  const { error } = await rpc('approve_collection', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectCollection(id: string, reason: string): Promise<void> {
  const { error } = await rpc('reject_collection', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function fetchPendingCollections(
  shiftId: string,
): Promise<PendingCollectionRow[]> {
  const { data, error } = await rpc('list_pending_collections_for_shift', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  return (data as PendingCollectionRow[]) ?? []
}

export async function fetchPendingExpenses(
  shiftId: string,
): Promise<PendingExpenseRow[]> {
  const { data, error } = await rpc('list_pending_expenses_for_shift', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  return (data as PendingExpenseRow[]) ?? []
}

export async function approveExpense(id: string): Promise<void> {
  const { error } = await rpc('approve_expense', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectExpense(id: string, reason: string): Promise<void> {
  const { error } = await rpc('reject_expense', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function updateFulfillmentStatus(
  orderId: string,
  status: FulfillmentStatus,
  reason?: string | null,
): Promise<void> {
  const { error } = await rpc('update_fulfillment_status', {
    p_order_id: orderId,
    p_status: status,
    p_reason: reason?.trim() || null,
  })
  if (error) throw wrap(error)
}

export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<void> {
  const { error } = await rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason.trim(),
  })
  if (error) throw wrap(error)
}

export async function reprintOrder(
  orderId: string,
  reason: string,
  kind: 'receipt' | 'kitchen' = 'receipt',
): Promise<void> {
  const { error } = await rpc('reprint_order', {
    p_order_id: orderId,
    p_kind: kind,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function reverseCollection(
  paymentId: string,
  reason: string,
): Promise<void> {
  const { error } = await rpc('reverse_collection', {
    p_id: paymentId,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function listDeliveryDrivers(
  activeOnly = true,
): Promise<DeliveryDriver[]> {
  const { data, error } = await rpc('list_delivery_drivers', {
    p_active_only: activeOnly,
  })
  if (error) throw wrap(error)
  return (data as DeliveryDriver[]) ?? []
}

export async function upsertDeliveryDriver(input: {
  id?: string
  displayName: string
  phone?: string | null
  notes?: string | null
  isActive?: boolean
}): Promise<string> {
  const { data, error } = await rpc('upsert_delivery_driver', {
    p_id: input.id ?? null,
    p_display_name: input.displayName,
    p_phone: input.phone ?? null,
    p_notes: input.notes ?? null,
    p_is_active: input.isActive ?? true,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function assignDeliveryDriver(
  orderId: string,
  driverId: string | null,
  reason?: string | null,
): Promise<void> {
  const { error } = await rpc('assign_delivery_driver', {
    p_order_id: orderId,
    p_driver_id: driverId,
    p_reason: reason ?? null,
  })
  if (error) throw wrap(error)
}

export async function fetchPosSearch(query: string): Promise<PosSearchResult> {
  const { data, error } = await rpc('pos_search', { p_query: query })
  if (error) throw wrap(error)
  return (data as PosSearchResult) ?? {
    orders: [],
    customers: [],
    menu_items: [],
  }
}

export function parsePendingSummary(
  shift: Record<string, unknown> | null,
): PendingSummary | null {
  if (!shift) return null
  const raw = shift.pending_collections_summary as PendingSummary | undefined
  if (raw) return raw
  return {
    count: Number(shift.pending_collections_count ?? 0),
    amount: Number(shift.pending_collections_amount ?? 0),
    by_payment_method:
      (shift.pending_by_payment_method as PendingSummary['by_payment_method']) ??
      [],
  }
}

export function parsePendingExpensesSummary(
  shift: Record<string, unknown> | null,
): PendingExpensesSummary | null {
  if (!shift) return null
  const raw = shift.pending_expenses_summary as PendingExpensesSummary | undefined
  if (raw) {
    return {
      count: Number(raw.count ?? 0),
      amount: Number(raw.amount ?? 0),
      by_category: raw.by_category ?? [],
    }
  }
  return {
    count: Number(shift.pending_expenses_count ?? 0),
    amount: Number(shift.pending_expenses_amount ?? 0),
    by_category: [],
  }
}
