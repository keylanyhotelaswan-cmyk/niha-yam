import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '@/features/print/api/print.api'
import { printKeys } from '@/features/print/hooks/print.keys'
import type {
  UpsertPrinterInput,
  UpsertPrintSettingsInput,
} from '@/features/print/types'

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: printKeys.all })
}

export function useUpsertPrinter() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: UpsertPrinterInput) => api.upsertPrinter(input),
    onSuccess: invalidate,
  })
}

export function useSetPrinterActive() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.setPrinterActive(id, active),
    onSuccess: invalidate,
  })
}

export function useUpsertPrintSettings() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: UpsertPrintSettingsInput) =>
      api.upsertPrintSettings(input),
    onSuccess: invalidate,
  })
}

export function useUpsertPrintDocumentLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      documentType: string
      layout: import('@/features/print/layout/sections').DocumentLayout
    }) => api.upsertPrintDocumentLayout(input.documentType, input.layout),
    onSuccess: (data, vars) => {
      qc.setQueryData(printKeys.documentLayout(vars.documentType), data)
      void qc.invalidateQueries({ queryKey: printKeys.documentLayout(vars.documentType) })
    },
  })
}

export function useEnqueueTestPrint() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (printerId: string) => api.enqueueTestPrint(printerId),
    onSuccess: invalidate,
  })
}

export function useDiagnosePrintSystem() {
  return useMutation({
    mutationFn: () => api.diagnosePrintSystem(),
  })
}

export function useSyncPrintStationBindings() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: () => api.syncPrintStationBindings(),
    onSuccess: invalidate,
  })
}

export function useEnqueueLayoutPreviewPrint() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: {
      documentType: string
      layout: import('@/features/print/layout/sections').DocumentLayout
      snapshot: Record<string, unknown>
    }) => api.enqueueLayoutPreviewPrint(input),
    onSuccess: invalidate,
  })
}

export function useRetryPrintJob() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (jobId: string) => api.retryPrintJob(jobId),
    onSuccess: invalidate,
  })
}

export function useCancelPrintJob() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) =>
      api.cancelPrintJob(jobId, reason),
    onSuccess: invalidate,
  })
}

export function usePrintJobAgain() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (jobId: string) => api.printJobAgain(jobId),
    onSuccess: invalidate,
  })
}

export function useCreatePairCode() {
  return useMutation({
    mutationFn: () => api.createPrintBridgePairCode(),
  })
}

export function useExpireStaleJobs() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: () => api.expireStalePrintJobs(),
    onSuccess: invalidate,
  })
}
