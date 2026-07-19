import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPurchases,
  fetchSupplierBalance,
  fetchSupplierPayments,
  fetchSupplierStatement,
  fetchSuppliers,
  postCreditPurchase,
  postDirectCashPurchase,
  postSupplierPayment,
  reverseCreditPurchase,
  reverseDirectCashPurchase,
  reverseSupplierPayment,
  setSupplierActive,
  upsertSupplier,
} from '@/features/purchasing/api/purchasing.api'
import { purchasingKeys } from '@/features/purchasing/hooks/purchasing.keys'
import type { PurchaseLineInput, PurchaseSourceKind } from '@/features/purchasing/types'

export function useSuppliers(activeOnly = false) {
  return useQuery({
    queryKey: purchasingKeys.suppliers(activeOnly),
    queryFn: () => fetchSuppliers(activeOnly),
    staleTime: 15_000,
  })
}

export function usePurchases() {
  return useQuery({
    queryKey: purchasingKeys.purchases(),
    queryFn: () => fetchPurchases(80),
    staleTime: 10_000,
  })
}

export function useSupplierBalance(supplierId: string | null) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'balance', supplierId],
    queryFn: () => fetchSupplierBalance(supplierId!),
    enabled: Boolean(supplierId),
    staleTime: 5_000,
  })
}

export function useSupplierStatement(supplierId: string | null) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'statement', supplierId],
    queryFn: () => fetchSupplierStatement(supplierId!),
    enabled: Boolean(supplierId),
    staleTime: 5_000,
  })
}

export function useSupplierPayments(supplierId: string | null) {
  return useQuery({
    queryKey: [...purchasingKeys.all, 'payments', supplierId],
    queryFn: () => fetchSupplierPayments(supplierId, 80),
    enabled: Boolean(supplierId),
    staleTime: 5_000,
  })
}

export function useUpsertSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertSupplier,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function useSetSupplierActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setSupplierActive(id, active),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function usePostDirectCashPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      treasury_id: string
      source_kind: PurchaseSourceKind
      supplier_id?: string | null
      direct_label?: string | null
      notes?: string | null
      lines: PurchaseLineInput[]
    }) => postDirectCashPurchase(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function usePostCreditPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      supplier_id: string
      notes?: string | null
      lines: PurchaseLineInput[]
    }) => postCreditPurchase(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function useReverseDirectCashPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reverseDirectCashPurchase(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function useReverseCreditPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reverseCreditPurchase(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function usePostSupplierPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postSupplierPayment,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}

export function useReverseSupplierPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reverseSupplierPayment(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: purchasingKeys.all })
    },
  })
}
