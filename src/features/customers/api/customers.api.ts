import { supabase } from '@/lib/supabase/client'
import { mapRpcError } from '@/shared/errors/rpc-error'
import { t } from '@/shared/i18n'
import type {
  CustomerListItem,
  CustomerProfile,
} from '@/features/customers/types'

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

export async function searchCustomers(
  query: string,
  limit = 20,
): Promise<CustomerListItem[]> {
  const { data, error } = await rpc('search_customers', {
    p_query: query,
    p_limit: limit,
  })
  if (error) throw wrap(error)
  return (data as CustomerListItem[]) ?? []
}

export async function fetchCustomerProfile(
  customerId: string,
): Promise<CustomerProfile> {
  const { data, error } = await rpc('get_customer_profile', {
    p_customer_id: customerId,
  })
  if (error) throw wrap(error)
  return data as CustomerProfile
}

export async function listFrequentCustomers(
  limit = 20,
): Promise<CustomerListItem[]> {
  const { data, error } = await rpc('list_frequent_customers', {
    p_limit: limit,
  })
  if (error) throw wrap(error)
  return (data as CustomerListItem[]) ?? []
}

export async function lookupCustomerByPhone(
  phone: string,
): Promise<CustomerProfile | null> {
  const { data, error } = await rpc('lookup_customer_by_phone', {
    p_phone: phone,
  })
  if (error) throw wrap(error)
  return (data as CustomerProfile | null) ?? null
}

export async function upsertCustomer(input: {
  displayName: string
  phone: string
  notes?: string | null
  address?: string | null
  deliveryZone?: string | null
}): Promise<string> {
  const { data, error } = await rpc('upsert_customer', {
    p_display_name: input.displayName,
    p_phone: input.phone,
    p_notes: input.notes ?? null,
    p_address: input.address ?? null,
    p_delivery_zone: input.deliveryZone ?? null,
  })
  if (error) throw wrap(error)
  return data as string
}
