import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  DateRange,
  DeliveryByDriverReport,
  ExpensesReport,
  ItemMixReport,
  OfficialSalesReport,
  OrdersSummaryReport,
  PrintReliabilityReport,
  ShiftListItem,
  TodaySummary,
  TreasuryLedgerReport,
} from '@/features/reports/types'

type ErrorCode = keyof typeof t.reports.errors

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.reports.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.reports.errors[code] : t.reports.errors.generic
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

export async function fetchTodaySummary(): Promise<TodaySummary> {
  const { data, error } = await rpc('report_today_summary')
  if (error) throw wrap(error)
  return data as TodaySummary
}

export async function fetchOfficialSales(
  range: DateRange,
): Promise<OfficialSalesReport> {
  const { data, error } = await rpc('report_official_sales', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return data as OfficialSalesReport
}

export async function fetchExpensesReport(
  range: DateRange,
): Promise<ExpensesReport> {
  const { data, error } = await rpc('report_expenses', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return data as ExpensesReport
}

export async function fetchTreasuryLedgerReport(
  treasuryId: string,
  range: DateRange,
): Promise<TreasuryLedgerReport> {
  const { data, error } = await rpc('report_treasury_ledger', {
    p_treasury_id: treasuryId,
    p_from: range.from,
    p_to: range.to,
    p_limit: 500,
  })
  if (error) throw wrap(error)
  return data as TreasuryLedgerReport
}

export async function fetchShiftsForReports(
  range: DateRange,
): Promise<ShiftListItem[]> {
  const { data, error } = await rpc('list_shifts_for_reports', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return (data as ShiftListItem[]) ?? []
}

export async function fetchShiftReport(
  shiftId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await rpc('get_shift_report', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  return (data as Record<string, unknown> | null) ?? null
}

export async function fetchOrdersSummary(
  range: DateRange,
): Promise<OrdersSummaryReport> {
  const { data, error } = await rpc('report_orders_summary', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return data as OrdersSummaryReport
}

export async function fetchDeliveryByDriver(
  range: DateRange,
): Promise<DeliveryByDriverReport> {
  const { data, error } = await rpc('report_delivery_by_driver', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return data as DeliveryByDriverReport
}

export async function fetchItemMix(
  range: DateRange,
): Promise<ItemMixReport> {
  const { data, error } = await rpc('report_item_mix', {
    p_from: range.from,
    p_to: range.to,
    p_limit: 50,
  })
  if (error) throw wrap(error)
  return data as ItemMixReport
}

export async function fetchPrintReliability(
  range: DateRange,
): Promise<PrintReliabilityReport> {
  const { data, error } = await rpc('report_print_reliability', {
    p_from: range.from,
    p_to: range.to,
  })
  if (error) throw wrap(error)
  return data as PrintReliabilityReport
}
