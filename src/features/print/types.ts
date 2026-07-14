export type PrinterRole = 'cashier' | 'kitchen' | 'label' | 'barcode' | string
export type PrinterConnection =
  | 'windows_spooler'
  | 'lan_9100'
  | 'usb'
  | 'bluetooth'
  | 'web_print'
  | 'other'
  | string
export type PrintJobKind =
  | 'receipt'
  | 'kitchen'
  | 'test_page'
  | 'label'
  | 'barcode'
  | string
export type PrintJobStatus =
  | 'pending'
  | 'claimed'
  | 'printing'
  | 'retry_wait'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | string

export type PrinterRow = {
  id: string
  name: string
  role: PrinterRole
  device_type: string
  connection: PrinterConnection
  address: Record<string, unknown>
  windows_printer_name?: string | null
  bridge_id?: string | null
  bridge_name?: string | null
  paper_width_mm: number
  encoding: string
  default_copies: number
  auto_cut: boolean
  open_cash_drawer: boolean
  logo_url: string | null
  footer_text: string | null
  is_active: boolean
  sort_order: number
  last_error: string | null
  last_success_at: string | null
}

export type BridgeDeviceRow = {
  id: string
  windows_name: string
  is_virtual: boolean
  last_seen_at: string
  assigned_printer_id: string | null
}

export type PrintBridgeRow = {
  id: string
  display_name: string
  device_name: string | null
  windows_username: string | null
  version: string | null
  last_heartbeat_at: string | null
  online: boolean
  is_active: boolean
  devices: BridgeDeviceRow[]
}

export type PrintTemplateRow = {
  id: string
  kind: PrintJobKind
  name: string
  version: number
  is_active: boolean
  body: {
    blocks?: Array<Record<string, unknown>>
    forbid_prices?: boolean
    [key: string]: unknown
  }
}

export type PrintJobRow = {
  id: string
  reference: string
  order_id: string | null
  kind: PrintJobKind
  status: PrintJobStatus
  printer_id: string | null
  is_reprint: boolean
  reprint_reason: string | null
  attempt_count: number
  last_error: string | null
  next_attempt_at: string | null
  created_at: string
  completed_at: string | null
  payload: Record<string, unknown> | null
}

export type PrintSettings = {
  print_job_ttl_minutes: number
  default_copies: number
  open_cash_drawer: boolean
  auto_cut: boolean
  paper_width_mm: number
  show_qr_on_receipt: boolean
  kitchen_show_prices: boolean
  thank_you_message: string | null
  receipt_slogan: string | null
  restaurant_phone: string | null
  restaurant_address: string | null
  font_title_pt: number
  font_body_pt: number
  font_total_pt: number
}

export type PrinterHealth = {
  bridge: {
    id: string
    display_name: string
    device_name: string | null
    windows_username: string | null
    version: string | null
    last_heartbeat_at: string | null
    last_connected_at: string | null
    last_restart_at: string | null
    online: boolean
  } | null
  bridges?: Array<{
    id: string
    display_name: string
    device_name: string | null
    windows_username: string | null
    version: string | null
    last_heartbeat_at: string | null
    online: boolean
    device_count: number
  }>
  queue: {
    pending: number
    failed: number
    completed_today: number
  }
  printers: Array<{
    id: string
    name: string
    role: PrinterRole
    is_active: boolean
    connection: PrinterConnection
    last_success_at: string | null
    last_error: string | null
    pending_jobs: number
    bridge_id?: string | null
    windows_printer_name?: string | null
  }>
}

export type PrintPreview = {
  template: PrintTemplateRow
  sample_data: Record<string, unknown>
}

export type PairCodeResult = {
  id: string
  code: string
  expires_at: string
  qr_payload: string
}

export type UpsertPrinterInput = {
  id: string | null
  name: string
  role: PrinterRole
  deviceType: string
  connection: PrinterConnection
  address: Record<string, unknown>
  paperWidthMm: number
  encoding: string
  defaultCopies: number
  autoCut: boolean
  openCashDrawer: boolean
  logoUrl: string | null
  footerText: string | null
  isActive: boolean
  sortOrder: number
  bridgeId?: string | null
  windowsPrinterName?: string | null
}

export type UpsertPrintSettingsInput = {
  printJobTtlMinutes?: number | null
  defaultCopies?: number | null
  openCashDrawer?: boolean | null
  autoCut?: boolean | null
  paperWidthMm?: number | null
  showQrOnReceipt?: boolean | null
  kitchenShowPrices?: boolean | null
  thankYouMessage?: string | null
  fontTitlePt?: number | null
  fontBodyPt?: number | null
  fontTotalPt?: number | null
  receiptSlogan?: string | null
  restaurantPhone?: string | null
  restaurantAddress?: string | null
}

export type PrintDiagnoseCheck = {
  id: string
  ok: boolean
  label: string
  detail: string | null
}

export type PrintSystemDiagnosis = {
  ready: boolean
  checked_at: string
  online_bridge: {
    id: string
    device_name: string | null
    display_name: string | null
    version: string | null
    last_heartbeat_at: string | null
    windows_username: string | null
  } | null
  checks: PrintDiagnoseCheck[]
  pending_jobs: Array<{
    id: string
    reference: string
    status: string
    attempt_count: number
    job_bridge_id: string | null
    printer_id: string | null
    printer_bridge_id: string | null
    windows_printer_name: string | null
    reject_reason: string
  }>
  printers: Array<{
    id: string
    name: string
    role: string
    bridge_id: string | null
    windows_printer_name: string | null
    bridge_online: boolean
  }>
  bridges: Array<{
    id: string
    device_name: string | null
    is_active: boolean
    online: boolean
    version: string | null
    last_heartbeat_at: string | null
    device_count: number
  }>
}

