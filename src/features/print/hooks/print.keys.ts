export const printKeys = {
  all: ['print'] as const,
  printers: () => [...printKeys.all, 'printers'] as const,
  bridges: () => [...printKeys.all, 'bridges'] as const,
  templates: () => [...printKeys.all, 'templates'] as const,
  settings: () => [...printKeys.all, 'settings'] as const,
  health: () => [...printKeys.all, 'health'] as const,
  jobs: (status?: string | null) =>
    [...printKeys.all, 'jobs', status ?? 'all'] as const,
  preview: (kind: string) => [...printKeys.all, 'preview', kind] as const,
  documentLayout: (docType: string) =>
    [...printKeys.all, 'documentLayout', docType] as const,
  documentPreview: (docType: string) =>
    [...printKeys.all, 'documentPreview', docType] as const,
  diagnose: () => [...printKeys.all, 'diagnose'] as const,
  ops: () => [...printKeys.all, 'ops'] as const,
}
