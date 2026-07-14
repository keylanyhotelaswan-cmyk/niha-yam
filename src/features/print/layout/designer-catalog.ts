/**
 * Extensible Print Designer catalog — modules register field groups for "إضافة عنصر".
 * Does not change Bridge/payload; only drives the designer UI.
 */

import {
  sectionsForDocumentType,
  type PrintDocumentType,
  type PrintFieldGroup,
} from '@/features/print/layout/sections'

export type DesignerCatalogItem = {
  /** Unique key: sectionId:fieldId */
  id: string
  sectionId: string
  fieldId: string
  labelKey: string
  documentTypes: PrintDocumentType[]
}

export type DesignerCatalogGroup = {
  id: string
  /** i18n key under t.print.layout.catalogGroups */
  labelKey: string
  /** Who registered this group — core | purchasing | … */
  source: string
  sortOrder: number
  items: DesignerCatalogItem[]
}

const extraGroups: DesignerCatalogGroup[] = []

/** Future modules call this once at boot to contribute Add-Element groups. */
export function registerPrintDesignerGroup(
  group: Omit<DesignerCatalogGroup, 'sortOrder'> & { sortOrder?: number },
): void {
  const next: DesignerCatalogGroup = {
    ...group,
    sortOrder: group.sortOrder ?? 100 + extraGroups.length,
  }
  const i = extraGroups.findIndex((g) => g.id === next.id)
  if (i >= 0) extraGroups[i] = next
  else extraGroups.push(next)
}

/** Map section.group → catalog group id (UX buckets). */
const CORE_GROUP_META: Record<
  PrintFieldGroup,
  { id: string; labelKey: string; sortOrder: number }
> = {
  restaurant: { id: 'restaurant', labelKey: 'restaurant', sortOrder: 10 },
  order: { id: 'order', labelKey: 'order', sortOrder: 20 },
  customer: { id: 'customer', labelKey: 'customer', sortOrder: 30 },
  lines: { id: 'lines', labelKey: 'lines', sortOrder: 40 },
  totals: { id: 'totals', labelKey: 'totals', sortOrder: 50 },
  payment: { id: 'payment', labelKey: 'payment', sortOrder: 60 },
  ops: { id: 'ops', labelKey: 'ops', sortOrder: 70 },
  other: { id: 'other', labelKey: 'other', sortOrder: 80 },
}

function buildCoreCatalog(docType: PrintDocumentType): DesignerCatalogGroup[] {
  const byId = new Map<string, DesignerCatalogGroup>()

  for (const sec of sectionsForDocumentType(docType)) {
    const meta = CORE_GROUP_META[sec.group]
    let group = byId.get(meta.id)
    if (!group) {
      group = {
        id: meta.id,
        labelKey: meta.labelKey,
        source: 'core',
        sortOrder: meta.sortOrder,
        items: [],
      }
      byId.set(meta.id, group)
    }
    for (const f of sec.fields) {
      group.items.push({
        id: `${sec.id}:${f.id}`,
        sectionId: sec.id,
        fieldId: f.id,
        labelKey: f.labelKey,
        documentTypes: [docType],
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getPrintDesignerCatalog(
  docType: PrintDocumentType,
): DesignerCatalogGroup[] {
  const core = buildCoreCatalog(docType)
  const extras = extraGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => it.documentTypes.includes(docType)),
    }))
    .filter((g) => g.items.length > 0)
  return [...core, ...extras].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function catalogItemKey(sectionId: string, fieldId: string): string {
  return `${sectionId}:${fieldId}`
}
