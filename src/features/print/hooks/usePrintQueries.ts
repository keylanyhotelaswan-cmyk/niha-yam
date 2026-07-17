import { useQuery } from '@tanstack/react-query'
import * as api from '@/features/print/api/print.api'
import { printKeys } from '@/features/print/hooks/print.keys'
import { isTestingEnv } from '@/shared/config/appEnv'

export function usePrinters() {
  return useQuery({
    queryKey: printKeys.printers(),
    queryFn: () => api.listPrinters(false),
  })
}

export function usePrintBridges() {
  return useQuery({
    queryKey: printKeys.bridges(),
    queryFn: () => api.listPrintBridges(),
    refetchInterval: 15_000,
  })
}

export function usePrintTemplates() {
  return useQuery({
    queryKey: printKeys.templates(),
    queryFn: () => api.listPrintTemplates(),
  })
}

export function usePrintSettings() {
  return useQuery({
    queryKey: printKeys.settings(),
    queryFn: () => api.getPrintSettings(),
  })
}

export function usePrinterHealth() {
  return useQuery({
    queryKey: printKeys.health(),
    queryFn: () => api.getPrinterHealth(),
    refetchInterval: 15_000,
  })
}

export function usePrintJobs(status?: string | null) {
  return useQuery({
    queryKey: printKeys.jobs(status),
    queryFn: () => api.listPrintJobs({ status, limit: 100 }),
    refetchInterval: 10_000,
  })
}

export function usePrintPreview(kind: string, enabled = true) {
  return useQuery({
    queryKey: printKeys.preview(kind),
    queryFn: () => api.previewPrintTemplate(kind),
    enabled: enabled && Boolean(kind),
  })
}

export function usePrintDocumentLayout(docType: string, enabled = true) {
  return useQuery({
    queryKey: printKeys.documentLayout(docType),
    queryFn: () => api.getPrintDocumentLayout(docType),
    enabled: enabled && Boolean(docType),
  })
}

export function usePrintDocumentPreview(docType: string, enabled = true) {
  return useQuery({
    queryKey: printKeys.documentPreview(docType),
    queryFn: () => api.previewPrintDocument(docType),
    enabled: enabled && Boolean(docType),
  })
}

/** Testing UI only — ops toggle state for armed banner / diagnostics. */
export function usePrintOpsSettings() {
  return useQuery({
    queryKey: printKeys.ops(),
    enabled: isTestingEnv(),
    queryFn: () => api.getPrintOpsSettings(),
    refetchInterval: 20_000,
  })
}
