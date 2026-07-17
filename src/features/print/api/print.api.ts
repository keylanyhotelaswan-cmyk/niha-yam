import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type { DocumentLayout } from '@/features/print/layout/sections'
import type {
  PairCodeResult,
  PrintBridgeRow,
  PrinterHealth,
  PrinterRow,
  PrintJobRow,
  PrintPreview,
  PrintSettings,
  PrintOpsSettings,
  PrintSystemDiagnosis,
  PrintTemplateRow,
  UpsertPrinterInput,
  UpsertPrintSettingsInput,
} from '@/features/print/types'

type PrintErrorCode = keyof typeof t.print.errors

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

function messageForCode(code: string): string {
  const known = t.print.errors as Record<string, string>
  return known[code] ?? t.print.errors.generic
}

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.print.errors) as PrintErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  if (code) return messageForCode(code)
  // Surface useful server hints (constraint / missing RPC) instead of opaque generic.
  const cleaned = message
    .replace(/^.*ERROR:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned && cleaned.length < 180 && !cleaned.toLowerCase().includes('json')) {
    return cleaned
  }
  return t.print.errors.generic
}

function wrap(error: { message: string }): Error {
  return new Error(rpcErrorMessage(error.message))
}

export async function listPrinters(activeOnly = false): Promise<PrinterRow[]> {
  const { data, error } = await rpc('list_printers', {
    p_active_only: activeOnly,
  })
  if (error) throw wrap(error)
  return (data as PrinterRow[]) ?? []
}

export async function upsertPrinter(input: UpsertPrinterInput): Promise<string> {
  const { data, error } = await rpc('upsert_printer', {
    p_id: input.id,
    p_name: input.name,
    p_role: input.role,
    p_device_type: input.deviceType,
    p_connection: input.connection,
    p_address: input.address,
    p_paper_width_mm: input.paperWidthMm,
    p_encoding: input.encoding,
    p_default_copies: input.defaultCopies,
    p_auto_cut: input.autoCut,
    p_open_cash_drawer: input.openCashDrawer,
    p_logo_url: input.logoUrl,
    p_footer_text: input.footerText,
    p_is_active: input.isActive,
    p_sort_order: input.sortOrder,
    p_bridge_id: input.bridgeId ?? null,
    p_windows_printer_name: input.windowsPrinterName ?? null,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function listPrintBridges(): Promise<PrintBridgeRow[]> {
  const { data, error } = await rpc('list_print_bridges')
  if (error) throw wrap(error)
  return (data as PrintBridgeRow[]) ?? []
}

export async function setPrinterActive(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await rpc('set_printer_active', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

export async function listPrintTemplates(): Promise<PrintTemplateRow[]> {
  const { data, error } = await rpc('list_print_templates')
  if (error) throw wrap(error)
  return (data as PrintTemplateRow[]) ?? []
}

export async function previewPrintTemplate(
  kind: string,
): Promise<PrintPreview> {
  const { data, error } = await rpc('preview_print_template', { p_kind: kind })
  if (error) throw wrap(error)
  return data as PrintPreview
}

export async function listPrintJobs(input?: {
  status?: string | null
  orderId?: string | null
  limit?: number
  offset?: number
}): Promise<PrintJobRow[]> {
  const { data, error } = await rpc('list_print_jobs', {
    p_status: input?.status ?? null,
    p_order_id: input?.orderId ?? null,
    p_limit: input?.limit ?? 100,
    p_offset: input?.offset ?? 0,
  })
  if (error) throw wrap(error)
  return (data as PrintJobRow[]) ?? []
}

export async function getPrinterHealth(): Promise<PrinterHealth> {
  const { data, error } = await rpc('get_printer_health')
  if (error) throw wrap(error)
  return data as PrinterHealth
}

export async function getPrintSettings(): Promise<PrintSettings> {
  const { data, error } = await rpc('get_print_settings')
  if (error) throw wrap(error)
  return data as PrintSettings
}

export async function upsertPrintSettings(
  input: UpsertPrintSettingsInput,
): Promise<PrintSettings> {
  const { data, error } = await rpc('upsert_print_settings', {
    p_print_job_ttl_minutes: input.printJobTtlMinutes ?? null,
    p_default_copies: input.defaultCopies ?? null,
    p_open_cash_drawer: input.openCashDrawer ?? null,
    p_auto_cut: input.autoCut ?? null,
    p_paper_width_mm: input.paperWidthMm ?? null,
    p_show_qr_on_receipt: input.showQrOnReceipt ?? null,
    p_kitchen_show_prices: input.kitchenShowPrices ?? null,
    p_thank_you_message: input.thankYouMessage ?? null,
    p_font_title_pt: input.fontTitlePt ?? null,
    p_font_body_pt: input.fontBodyPt ?? null,
    p_font_total_pt: input.fontTotalPt ?? null,
    p_receipt_slogan: input.receiptSlogan ?? null,
    p_restaurant_phone: input.restaurantPhone ?? null,
    p_restaurant_address: input.restaurantAddress ?? null,
  })
  if (error) throw wrap(error)
  return data as PrintSettings
}

export async function enqueueTestPrint(printerId: string): Promise<string> {
  const { data, error } = await rpc('enqueue_test_print', {
    p_printer_id: printerId,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function diagnosePrintSystem(): Promise<PrintSystemDiagnosis> {
  const { data, error } = await rpc('diagnose_print_system')
  if (error) throw wrap(error)
  const diagnosis = data as PrintSystemDiagnosis
  try {
    const ops = await getPrintOpsSettings()
    const ready =
      ops.is_test_environment && !ops.testing_print_enabled
        ? false
        : diagnosis.ready
    return { ...diagnosis, ready, print_ops: ops }
  } catch {
    return diagnosis
  }
}

export async function getPrintOpsSettings(): Promise<PrintOpsSettings> {
  const { data, error } = await rpc('get_print_ops_settings')
  if (error) throw wrap(error)
  return data as PrintOpsSettings
}

export async function bootstrapTestPrintEnvironment(): Promise<PrintOpsSettings> {
  // Hotfix guard: never mark Production Supabase as a test print environment.
  // (Accidental bootstrap + testing_print_enabled=OFF blocks claim_print_jobs.)
  const url = import.meta.env.VITE_SUPABASE_URL ?? ''
  if (url.includes('nzwgoavyrshuypkugvzc')) {
    return getPrintOpsSettings()
  }
  const { data, error } = await rpc('m6_bootstrap_test_print_environment')
  if (error) throw wrap(error)
  return data as PrintOpsSettings
}

export async function setTestingPrintEnabled(
  enabled: boolean,
): Promise<PrintOpsSettings> {
  const { data, error } = await rpc('set_testing_print_enabled', {
    p_enabled: enabled,
  })
  if (error) throw wrap(error)
  return data as PrintOpsSettings
}

export async function syncPrintStationBindings(): Promise<{
  ok?: boolean
  updated?: number
  renamed?: number
  bridge_id?: string
  reason?: string
  picked_windows_name?: string | null
  needs_choice?: boolean
  actions?: Array<{
    printer_id: string
    from: string | null
    to: string | null
    reason: string
    score?: number
    detail?: string
  }>
}> {
  const { data, error } = await rpc('sync_print_station_bindings')
  if (error) throw wrap(error)
  return (data as Record<string, unknown>) ?? {}
}

export async function chooseCashierWindowsPrinter(
  windowsName: string,
): Promise<{
  ok?: boolean
  reason?: string
  windows_name?: string
  reason_ar?: string
}> {
  const { data, error } = await rpc('choose_cashier_windows_printer', {
    p_windows_name: windowsName,
  })
  if (error) throw wrap(error)
  return (data as Record<string, unknown>) ?? {}
}

/** OES: shift handover slip via Bridge (kind = shift_handover). */
export async function enqueueShiftHandoverPrint(
  handoverId: string,
  phase: 'handover' | 'receive' = 'handover',
): Promise<string> {
  const { data, error } = await rpc('m6_enqueue_shift_handover_print', {
    p_handover_id: handoverId,
    p_phase: phase,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function fetchHandoverPrintSnapshot(
  handoverId: string,
  phase: 'handover' | 'receive' = 'handover',
): Promise<Record<string, unknown>> {
  const { data, error } = await rpc('m6_build_handover_print_snapshot', {
    p_handover_id: handoverId,
    p_phase: phase,
  })
  if (error) throw wrap(error)
  return (data as Record<string, unknown>) ?? {}
}

export async function retryPrintJob(jobId: string): Promise<void> {
  const { error } = await rpc('retry_print_job', { p_job_id: jobId })
  if (error) throw wrap(error)
}

export async function cancelPrintJob(
  jobId: string,
  reason: string,
): Promise<void> {
  const { error } = await rpc('cancel_print_job', {
    p_job_id: jobId,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function printJobAgain(jobId: string): Promise<string> {
  const { data, error } = await rpc('print_job_again', { p_job_id: jobId })
  if (error) throw wrap(error)
  return data as string
}

export async function createPrintBridgePairCode(): Promise<PairCodeResult> {
  const { data, error } = await rpc('create_print_bridge_pair_code')
  if (error) throw wrap(error)
  return data as PairCodeResult
}

export async function expireStalePrintJobs(): Promise<number> {
  const { data, error } = await rpc('expire_stale_print_jobs')
  if (error) throw wrap(error)
  return Number(data ?? 0)
}

export async function getPrintDocumentLayout(
  documentType: string,
): Promise<{ document_type: string; layout: DocumentLayout }> {
  const { data, error } = await rpc('get_print_document_layout', {
    p_document_type: documentType,
  })
  if (error) throw wrap(error)
  return data as { document_type: string; layout: DocumentLayout }
}

export async function upsertPrintDocumentLayout(
  documentType: string,
  layout: DocumentLayout,
): Promise<{ document_type: string; layout: DocumentLayout }> {
  const { data, error } = await rpc('upsert_print_document_layout', {
    p_document_type: documentType,
    p_layout: layout,
  })
  if (error) throw wrap(error)
  return data as { document_type: string; layout: DocumentLayout }
}

export async function previewPrintDocument(
  documentType: string,
): Promise<{
  document_type: string
  layout: DocumentLayout
  sample_snapshot: Record<string, unknown>
}> {
  const { data, error } = await rpc('preview_print_document', {
    p_document_type: documentType,
  })
  if (error) throw wrap(error)
  return data as {
    document_type: string
    layout: DocumentLayout
    sample_snapshot: Record<string, unknown>
  }
}

export async function enqueueLayoutPreviewPrint(input: {
  documentType: string
  layout: DocumentLayout
  snapshot: Record<string, unknown>
}): Promise<string> {
  const { data, error } = await rpc('enqueue_layout_preview_print', {
    p_document_type: input.documentType,
    p_layout: input.layout,
    p_snapshot: input.snapshot,
  })
  if (error) throw wrap(error)
  return data as string
}
