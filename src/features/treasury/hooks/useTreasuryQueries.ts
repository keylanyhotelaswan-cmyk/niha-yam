import { useQuery } from '@tanstack/react-query'
import {
  fetchAdjustments,
  fetchBalances,
  fetchExpenses,
  fetchLedger,
  fetchOpenShift,
  fetchPaymentMethods,
  fetchPendingHandovers,
  fetchShiftArchive,
  fetchShiftsArchive,
  fetchTransfers,
  fetchTreasuries,
} from '@/features/treasury/api/treasury.api'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'

export function useBalances() {
  return useQuery({
    queryKey: treasuryKeys.balances(),
    queryFn: fetchBalances,
  })
}

export function useOpenShift() {
  return useQuery({
    queryKey: treasuryKeys.openShift(),
    queryFn: fetchOpenShift,
  })
}

export function useLedger(treasuryId: string | null) {
  return useQuery({
    queryKey: treasuryKeys.ledger(treasuryId ?? 'none'),
    queryFn: () => fetchLedger(treasuryId as string),
    enabled: treasuryId !== null,
  })
}

export function useTreasuries() {
  return useQuery({
    queryKey: treasuryKeys.treasuries(),
    queryFn: fetchTreasuries,
  })
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: treasuryKeys.paymentMethods(),
    queryFn: fetchPaymentMethods,
  })
}

export function useTransfers() {
  return useQuery({
    queryKey: treasuryKeys.transfers(),
    queryFn: fetchTransfers,
  })
}

export function useExpenses() {
  return useQuery({
    queryKey: treasuryKeys.expenses(),
    queryFn: fetchExpenses,
  })
}

export function useAdjustments() {
  return useQuery({
    queryKey: treasuryKeys.adjustments(),
    queryFn: fetchAdjustments,
  })
}

export function usePendingHandovers() {
  return useQuery({
    queryKey: treasuryKeys.pendingHandovers(),
    queryFn: fetchPendingHandovers,
    refetchInterval: 15_000,
  })
}

export function useShiftsArchive() {
  return useQuery({
    queryKey: treasuryKeys.shiftsArchive(),
    queryFn: () => fetchShiftsArchive(50),
  })
}

export function useShiftArchive(shiftId: string | null) {
  return useQuery({
    queryKey: treasuryKeys.shiftArchive(shiftId ?? 'none'),
    queryFn: () => fetchShiftArchive(shiftId as string),
    enabled: shiftId !== null,
  })
}
