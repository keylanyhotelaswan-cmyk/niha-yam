import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  PostDirectCashResult,
  Purchase,
  PurchaseLineInput,
  PurchaseSourceKind,
  Supplier,
  SupplierBalance,
  SupplierPayment,
  SupplierStatement,
} from '@/features/purchasing/types'

type ErrorCode = keyof typeof t.purchasing.errors

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.purchasing.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.purchasing.errors[code] : t.purchasing.errors.generic
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

export async function fetchSuppliers(activeOnly = true): Promise<Supplier[]> {
  const { data, error } = await rpc('pur_list_suppliers', {
    p_active_only: activeOnly,
  })
  if (error) throw wrap(error)
  return (data as Supplier[]) ?? []
}

export async function upsertSupplier(input: {
  id?: string | null
  name_ar: string
  name_en?: string | null
  code?: string | null
  phone?: string | null
  notes?: string | null
  is_active?: boolean
}): Promise<Supplier> {
  const { data, error } = await rpc('pur_upsert_supplier', {
    p_id: input.id ?? null,
    p_name_ar: input.name_ar,
    p_name_en: input.name_en ?? null,
    p_code: input.code ?? null,
    p_phone: input.phone ?? null,
    p_notes: input.notes ?? null,
    p_is_active: input.is_active ?? true,
  })
  if (error) throw wrap(error)
  return data as Supplier
}

export async function setSupplierActive(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await rpc('pur_set_supplier_active', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

export async function fetchPurchases(limit = 50): Promise<Purchase[]> {
  const { data, error } = await rpc('pur_list_purchases', { p_limit: limit })
  if (error) throw wrap(error)
  return (data as Purchase[]) ?? []
}

export async function fetchPurchase(id: string): Promise<Purchase> {
  const { data, error } = await rpc('pur_get_purchase', { p_id: id })
  if (error) throw wrap(error)
  return data as Purchase
}

export async function postDirectCashPurchase(input: {
  treasury_id: string
  source_kind: PurchaseSourceKind
  supplier_id?: string | null
  direct_label?: string | null
  notes?: string | null
  lines: PurchaseLineInput[]
}): Promise<PostDirectCashResult> {
  const { data, error } = await rpc('pur_post_direct_cash_purchase', {
    p_treasury_id: input.treasury_id,
    p_source_kind: input.source_kind,
    p_supplier_id: input.supplier_id ?? null,
    p_direct_label: input.direct_label ?? null,
    p_notes: input.notes ?? null,
    p_lines: input.lines,
  })
  if (error) throw wrap(error)
  return data as PostDirectCashResult
}

export async function reverseDirectCashPurchase(
  id: string,
  reason: string,
): Promise<{ id: string; reference: string; status: string }> {
  const { data, error } = await rpc('pur_reverse_direct_cash_purchase', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
  return data as { id: string; reference: string; status: string }
}

export async function postCreditPurchase(input: {
  supplier_id: string
  notes?: string | null
  lines: PurchaseLineInput[]
}): Promise<PostDirectCashResult> {
  const { data, error } = await rpc('pur_post_credit_purchase', {
    p_supplier_id: input.supplier_id,
    p_notes: input.notes ?? null,
    p_lines: input.lines,
  })
  if (error) throw wrap(error)
  return data as PostDirectCashResult
}

export async function reverseCreditPurchase(
  id: string,
  reason: string,
): Promise<{ id: string; reference: string; status: string }> {
  const { data, error } = await rpc('pur_reverse_credit_purchase', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
  return data as { id: string; reference: string; status: string }
}

export async function postSupplierPayment(input: {
  supplier_id: string
  treasury_id: string
  amount: number
  notes?: string | null
}): Promise<{
  id: string
  reference: string
  amount: number
  open_balance_after: number
}> {
  const { data, error } = await rpc('pur_post_supplier_payment', {
    p_supplier_id: input.supplier_id,
    p_treasury_id: input.treasury_id,
    p_amount: input.amount,
    p_notes: input.notes ?? null,
  })
  if (error) throw wrap(error)
  return data as {
    id: string
    reference: string
    amount: number
    open_balance_after: number
  }
}

export async function reverseSupplierPayment(
  id: string,
  reason: string,
): Promise<{ id: string; reference: string; status: string }> {
  const { data, error } = await rpc('pur_reverse_supplier_payment', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
  return data as { id: string; reference: string; status: string }
}

export async function fetchSupplierBalance(
  supplierId: string,
): Promise<SupplierBalance> {
  const { data, error } = await rpc('pur_get_supplier_balance', {
    p_supplier_id: supplierId,
  })
  if (error) throw wrap(error)
  return data as SupplierBalance
}

export async function fetchSupplierStatement(
  supplierId: string,
  limit = 200,
): Promise<SupplierStatement> {
  const { data, error } = await rpc('pur_get_supplier_statement', {
    p_supplier_id: supplierId,
    p_limit: limit,
  })
  if (error) throw wrap(error)
  return data as SupplierStatement
}

export async function fetchSupplierPayments(
  supplierId?: string | null,
  limit = 50,
): Promise<SupplierPayment[]> {
  const { data, error } = await rpc('pur_list_supplier_payments', {
    p_supplier_id: supplierId ?? null,
    p_limit: limit,
  })
  if (error) throw wrap(error)
  return (data as SupplierPayment[]) ?? []
}

export type OpsIngredient = {
  id: string
  name_ar: string
  base_uom_id: string
  base_uom_code: string
  base_uom_name_ar?: string
  is_active: boolean
}

export type OpsUom = {
  id: string
  code: string
  name_ar: string
}

export async function fetchOpsIngredients(): Promise<OpsIngredient[]> {
  const { data, error } = await rpc('pur_list_ops_ingredients')
  if (error) throw wrap(error)
  return (data as OpsIngredient[]) ?? []
}

export async function fetchOpsSuppliers(): Promise<
  Array<{ id: string; name_ar: string; code: string | null }>
> {
  const { data, error } = await rpc('pur_list_ops_suppliers')
  if (error) throw wrap(error)
  return (
    (data as Array<{ id: string; name_ar: string; code: string | null }>) ??
    []
  )
}

export async function fetchOpsUoms(): Promise<OpsUom[]> {
  // Prefer volatile bootstrap (seed defaults) then fall back to read-only list.
  const boot = await rpc('pur_bootstrap_ops_uoms')
  if (!boot.error) return (boot.data as OpsUom[]) ?? []
  const { data, error } = await rpc('pur_list_ops_uoms')
  if (error) throw wrap(error)
  return (data as OpsUom[]) ?? []
}

export async function createOpsIngredient(input: {
  name_ar: string
  base_uom_id: string
  standard_cost?: number
}): Promise<OpsIngredient> {
  const { data, error } = await rpc('pur_create_ops_ingredient', {
    p_name_ar: input.name_ar,
    p_base_uom_id: input.base_uom_id,
    p_standard_cost: input.standard_cost ?? 0,
  })
  if (error) throw wrap(error)
  return data as OpsIngredient
}
