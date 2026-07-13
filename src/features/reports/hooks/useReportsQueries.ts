import { useQuery } from '@tanstack/react-query'
import {
  fetchDeliveryByDriver,
  fetchExpensesReport,
  fetchItemMix,
  fetchOfficialSales,
  fetchOrdersSummary,
  fetchPrintReliability,
  fetchShiftReport,
  fetchShiftsForReports,
  fetchTodaySummary,
  fetchTreasuryLedgerReport,
} from '@/features/reports/api/reports.api'
import { reportsKeys } from '@/features/reports/hooks/reports.keys'
import type { DateRange } from '@/features/reports/types'

export function useTodaySummary(enabled = true) {
  return useQuery({
    queryKey: reportsKeys.today(),
    queryFn: fetchTodaySummary,
    enabled,
    staleTime: 30_000,
  })
}

export function useOfficialSales(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.sales(range.from, range.to),
    queryFn: () => fetchOfficialSales(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useExpensesReport(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.expenses(range.from, range.to),
    queryFn: () => fetchExpensesReport(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useTreasuryLedgerReport(
  treasuryId: string | null,
  range: DateRange,
  enabled = true,
) {
  return useQuery({
    queryKey: reportsKeys.ledger(treasuryId ?? '', range.from, range.to),
    queryFn: () => fetchTreasuryLedgerReport(treasuryId!, range),
    enabled: enabled && !!treasuryId && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useShiftsForReports(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.shifts(range.from, range.to),
    queryFn: () => fetchShiftsForReports(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useShiftReport(shiftId: string | null, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.shift(shiftId ?? ''),
    queryFn: () => fetchShiftReport(shiftId!),
    enabled: enabled && !!shiftId,
    staleTime: 30_000,
  })
}

export function useOrdersSummary(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.orders(range.from, range.to),
    queryFn: () => fetchOrdersSummary(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useDeliveryByDriver(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.delivery(range.from, range.to),
    queryFn: () => fetchDeliveryByDriver(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function useItemMix(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.items(range.from, range.to),
    queryFn: () => fetchItemMix(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}

export function usePrintReliability(range: DateRange, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.print(range.from, range.to),
    queryFn: () => fetchPrintReliability(range),
    enabled: enabled && !!range.from && !!range.to,
    staleTime: 30_000,
  })
}
