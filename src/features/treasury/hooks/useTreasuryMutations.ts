import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '@/features/treasury/api/treasury.api'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import type {
  CreateAdjustmentInput,
  CreateExpenseInput,
  CreateTransferInput,
  UpsertTreasuryInput,
} from '@/features/treasury/types'

/**
 * All money mutations invalidate the whole treasury tree. Because every
 * balance and report is computed from the ledger, refreshing together keeps
 * the UI consistent with the single source of truth without stored summaries.
 */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: treasuryKeys.all })
}

type IdReason = { id: string; reason: string }

export function useOpenShift() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: {
      openingFloat: number
      receiveHandoverId?: string | null
      receivedActualCash?: number | null
    }) =>
      api.openShift(
        input.openingFloat,
        input.receiveHandoverId,
        input.receivedActualCash,
      ),
    onSuccess: invalidate,
  })
}

export function useCloseShift() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: {
      actualCashCount: number
      differenceReason: string | null
      notes: string | null
      destination: 'to_main' | 'to_next_shift'
    }) => api.closeShift(input),
    onSuccess: invalidate,
  })
}

export function useReceiveTreasuryHandover() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => api.receiveTreasuryHandover(id),
    onSuccess: invalidate,
  })
}

export function useRejectShiftHandover() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) =>
      api.rejectShiftHandover(id, reason),
    onSuccess: invalidate,
  })
}

export function useRecreateShiftHandover() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: {
      shiftId: string
      destination: 'to_main' | 'to_next_shift'
    }) => api.recreateShiftHandover(input.shiftId, input.destination),
    onSuccess: invalidate,
  })
}

export function useCashDrop() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string | null }) =>
      api.cashDrop(amount, reason),
    onSuccess: invalidate,
  })
}

export function useCreateTransfer() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: CreateTransferInput) => api.createTransfer(input),
    onSuccess: invalidate,
  })
}

export function useApproveTransfer() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => api.approveTransfer(id),
    onSuccess: invalidate,
  })
}

export function useRejectTransfer() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.rejectTransfer(id, reason),
    onSuccess: invalidate,
  })
}

export function useReverseTransfer() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.reverseTransfer(id, reason),
    onSuccess: invalidate,
  })
}

export function useCreateExpense() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => api.createExpense(input),
    onSuccess: invalidate,
  })
}

export function useApproveExpense() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => api.approveExpense(id),
    onSuccess: invalidate,
  })
}

export function useRejectExpense() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.rejectExpense(id, reason),
    onSuccess: invalidate,
  })
}

export function useReverseExpense() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.reverseExpense(id, reason),
    onSuccess: invalidate,
  })
}

export function useCreateAdjustment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: CreateAdjustmentInput) => api.createAdjustment(input),
    onSuccess: invalidate,
  })
}

export function useApproveAdjustment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) => api.approveAdjustment(id),
    onSuccess: invalidate,
  })
}

export function useRejectAdjustment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.rejectAdjustment(id, reason),
    onSuccess: invalidate,
  })
}

export function useReverseAdjustment() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, reason }: IdReason) => api.reverseAdjustment(id, reason),
    onSuccess: invalidate,
  })
}

export function useUpsertTreasury() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: UpsertTreasuryInput) => api.upsertTreasury(input),
    onSuccess: invalidate,
  })
}

export function useSetTreasuryStatus() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.setTreasuryStatus(id, active),
    onSuccess: invalidate,
  })
}

export function useSetPaymentMethodMapping() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, treasuryId }: { id: string; treasuryId: string | null }) =>
      api.setPaymentMethodMapping(id, treasuryId),
    onSuccess: invalidate,
  })
}

export function useSetPaymentMethodStatus() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.setPaymentMethodStatus(id, active),
    onSuccess: invalidate,
  })
}
