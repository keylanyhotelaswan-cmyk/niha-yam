export type CustomerListItem = {
  id: string
  display_name: string
  primary_phone: string | null
  order_count?: number
  total_purchases?: number
}

export type CustomerPhone = {
  id: string
  phone_raw: string
  label: string | null
  is_primary: boolean
}

export type CustomerAddress = {
  id: string
  label: string | null
  address_line: string
  delivery_zone: string | null
  is_default: boolean
}

export type CustomerRecentOrder = {
  id: string
  reference: string
  total: number
  payment_status: string
  fulfillment_status?: string
  created_at: string
}

export type CustomerProfile = {
  id: string
  display_name: string
  notes: string | null
  phones: CustomerPhone[]
  addresses: CustomerAddress[]
  order_count: number
  total_purchases: number
  last_order_at?: string | null
  open_order?: CustomerRecentOrder | null
  recent_orders: CustomerRecentOrder[]
}
