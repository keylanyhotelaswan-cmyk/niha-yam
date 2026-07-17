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
  driver_name?: string | null
  port_name?: string | null
  device_id?: string | null
  is_default?: boolean
}

export type PrintRemapProposal = {
  printer_id: string
  printer_name: string
  role: string
  from: string | null
  to: string | null
  reason: string | null
  score?: number | string | null
  detail?: string | null
  applied?: boolean
  at?: string | null
  needs_choice?: boolean
  candidates?: Array<{ windows_name: string; is_default?: boolean }>
}

export type PrintSelectionStory = {
  connected: boolean
  bridge_version?: string | null
  device_label?: string | null
  active_printer?: string | null
  previous_printer?: string | null
  reason_code?: string | null
  reason_ar: string
  status_message_ar: string
  last_remap_at?: string | null
  last_remap_from?: string | null
  last_remap_to?: string | null
  needs_choice?: boolean
  candidates?: Array<{ windows_name: string; is_default?: boolean }>
  auto_applied?: boolean
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
  from_name?: string | null
  to_name?: string | null
  reason?: string | null
  score?: number | null
  can_apply?: boolean
}

export type PrintOpsSettings = {
  restaurant_id: string
  is_test_environment: boolean
  testing_print_enabled: boolean
  updated_at: string
}

export type PrintSystemDiagnosis = {
  ready: boolean
  checked_at: string
  selection?: PrintSelectionStory | null
  online_bridge: {
    id: string
    device_name: string | null
    display_name: string | null
    version: string | null
    last_heartbeat_at: string | null
    windows_username: string | null
  } | null
  checks: PrintDiagnoseCheck[]
  remaps?: PrintRemapProposal[]
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
    driver_name?: string | null
    port_name?: string | null
    last_remap?: Record<string, unknown> | null
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
  /** Present when client merges get_print_ops_settings into diagnosis. */
  print_ops?: PrintOpsSettings | null
}

