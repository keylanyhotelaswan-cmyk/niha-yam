import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Settings2, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AddElementDialog } from '@/features/print/components/designer/AddElementDialog'
import {
  ElementSettingsDialog,
  type ElementSelection,
} from '@/features/print/components/designer/ElementSettingsDialog'
import { ThermalReceiptPreview } from '@/features/print/components/ThermalReceiptPreview'
import {
  useEnqueueLayoutPreviewPrint,
  useUpsertPrintDocumentLayout,
} from '@/features/print/hooks/usePrintMutations'
import { printKeys } from '@/features/print/hooks/print.keys'
import {
  usePrintDocumentLayout,
  usePrintSettings,
} from '@/features/print/hooks/usePrintQueries'
import {
  catalogItemKey,
  getPrintDesignerCatalog,
  type DesignerCatalogItem,
} from '@/features/print/layout/designer-catalog'
import {
  defaultLayoutFor,
  mergeLayout,
  PRINT_DOCUMENT_TYPES,
  sectionsForDocumentType,
  type DocumentLayout,
  type FieldStyle,
  type PrintDocumentType,
  type SectionStyle,
} from '@/features/print/layout/sections'
import {
  buildScenarioSnapshot,
  defaultScenarioId,
  scenariosForDocumentType,
  type PreviewScenarioId,
} from '@/features/print/layout/scenarios'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type DocElement = {
  sectionId: string
  fieldId: string
  fieldLabel: string
  sectionLabel: string
}

function SortableSectionBlock({
  sectionId,
  sectionLabel,
  elements,
  selectedKey,
  onSelect,
  onRemoveField,
}: {
  sectionId: string
  sectionLabel: string
  elements: DocElement[]
  selectedKey: string | null
  onSelect: (el: DocElement) => void
  onRemoveField: (sectionId: string, fieldId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionId })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'border-border bg-card rounded-lg border',
        isDragging && 'border-primary z-10 opacity-95 shadow-md',
      )}
    >
      <div className="flex items-center gap-1 border-b px-1 py-2">
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted/60 flex cursor-grab items-center px-2 py-1 active:cursor-grabbing"
          aria-label={t.print.layout.dragHandle}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {sectionLabel}
        </p>
        <span className="text-muted-foreground pe-2 text-xs">
          {elements.length}
        </span>
      </div>
      <ul className="divide-border divide-y">
        {elements.map((el) => {
          const key = catalogItemKey(el.sectionId, el.fieldId)
          const selected = selectedKey === key
          return (
            <li key={key} className="flex items-stretch">
              <button
                type="button"
                className={cn(
                  'hover:bg-muted/40 flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-start text-sm',
                  selected && 'bg-muted/60',
                )}
                onClick={() => onSelect(el)}
              >
                <span className="min-w-0 flex-1 truncate">{el.fieldLabel}</span>
                <Settings2 className="text-muted-foreground size-3.5 shrink-0" />
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:bg-muted/60 hover:text-destructive px-2"
                aria-label={t.print.layout.removeFromDocument}
                onClick={() => onRemoveField(el.sectionId, el.fieldId)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function LayoutTab() {
  const [docType, setDocType] = useState<PrintDocumentType>('receipt')
  const [scenarioId, setScenarioId] = useState<PreviewScenarioId>(() =>
    defaultScenarioId('receipt'),
  )
  const [draft, setDraft] = useState<DocumentLayout>(() =>
    defaultLayoutFor('receipt'),
  )
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selection, setSelection] = useState<ElementSelection | null>(null)

  const dirtyRef = useRef(false)
  const loadedForTypeRef = useRef<PrintDocumentType | null>(null)

  const layoutQuery = usePrintDocumentLayout(docType)
  const settingsQuery = usePrintSettings()
  const save = useUpsertPrintDocumentLayout()
  const testPrint = useEnqueueLayoutPreviewPrint()
  const queryClient = useQueryClient()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    setScenarioId(defaultScenarioId(docType))
  }, [docType])

  useEffect(() => {
    if (!layoutQuery.data?.layout) return
    if (dirtyRef.current && loadedForTypeRef.current === docType) return
    const next = mergeLayout(docType, layoutQuery.data.layout)
    setDraft(next)
    dirtyRef.current = false
    loadedForTypeRef.current = docType
  }, [layoutQuery.data, docType])

  const sectionLabels = t.print.layout.sections as Record<string, string>
  const fieldLabels = t.print.layout.fields as Record<string, string>
  const scenarioLabels = t.print.layout.scenarios as Record<string, string>
  const catalog = useMemo(() => getPrintDesignerCatalog(docType), [docType])
  const defs = useMemo(() => sectionsForDocumentType(docType), [docType])

  const branding = useMemo(() => {
    const ps = settingsQuery.data
    return {
      restaurant_name: undefined as string | undefined,
      slogan: ps?.receipt_slogan,
      restaurant_phone: ps?.restaurant_phone,
      restaurant_address: ps?.restaurant_address,
      thank_you: ps?.thank_you_message,
      show_qr: ps?.show_qr_on_receipt,
    }
  }, [settingsQuery.data])

  const snapshot = useMemo(
    () => buildScenarioSnapshot(scenarioId, branding),
    [scenarioId, branding],
  )

  const documentElements = useMemo(() => {
    const bySection = new Map<string, DocElement[]>()
    for (const sectionId of draft.section_order) {
      const sec = draft.sections[sectionId]
      const def = defs.find((d) => d.id === sectionId)
      if (!sec?.visible || !def) continue
      const els: DocElement[] = []
      for (const fd of def.fields) {
        const f = sec.fields[fd.id]
        if (!f?.visible) continue
        els.push({
          sectionId,
          fieldId: fd.id,
          fieldLabel: fieldLabels[fd.labelKey] ?? fd.id,
          sectionLabel: sectionLabels[def.labelKey] ?? sectionId,
        })
      }
      if (els.length > 0) bySection.set(sectionId, els)
    }
    return bySection
  }, [draft, defs, fieldLabels, sectionLabels])

  const sortableSectionIds = useMemo(
    () => [...documentElements.keys()],
    [documentElements],
  )

  const onDocumentKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const els of documentElements.values()) {
      for (const el of els) keys.add(catalogItemKey(el.sectionId, el.fieldId))
    }
    return keys
  }, [documentElements])

  const selectedField: FieldStyle | null = selection
    ? (draft.sections[selection.sectionId]?.fields[selection.fieldId] ?? null)
    : null
  const selectedSection: SectionStyle | null = selection
    ? (draft.sections[selection.sectionId] ?? null)
    : null
  const selectedKey = selection
    ? catalogItemKey(selection.sectionId, selection.fieldId)
    : null

  function markDirty(next: DocumentLayout) {
    setDraft(next)
    dirtyRef.current = true
  }

  function patchField(
    sectionId: string,
    fieldId: string,
    patch: Partial<FieldStyle>,
  ) {
    const sec = draft.sections[sectionId]
    if (!sec) return
    const field = sec.fields[fieldId]
    if (!field) return
    markDirty({
      ...draft,
      sections: {
        ...draft.sections,
        [sectionId]: {
          ...sec,
          visible: patch.visible === false ? sec.visible : true,
          fields: {
            ...sec.fields,
            [fieldId]: { ...field, ...patch },
          },
        },
      },
    })
  }

  function addItems(items: DesignerCatalogItem[]) {
    const sections = { ...draft.sections }
    for (const it of items) {
      const sec = sections[it.sectionId]
      const field = sec?.fields[it.fieldId]
      if (!sec || !field) continue
      sections[it.sectionId] = {
        ...sec,
        visible: true,
        fields: {
          ...sec.fields,
          [it.fieldId]: { ...field, visible: true },
        },
      }
    }
    markDirty({ ...draft, sections })
    toast.success(t.print.layout.elementsAdded)
  }

  function removeField(sectionId: string, fieldId: string) {
    patchField(sectionId, fieldId, { visible: false })
    if (
      selection?.sectionId === sectionId &&
      selection.fieldId === fieldId
    ) {
      setSettingsOpen(false)
      setSelection(null)
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = draft.section_order.indexOf(String(active.id))
    const newIndex = draft.section_order.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    markDirty({
      ...draft,
      section_order: arrayMove(draft.section_order, oldIndex, newIndex),
    })
  }

  function onSave() {
    save.mutate(
      { documentType: docType, layout: draft },
      {
        onSuccess: (data) => {
          const next = mergeLayout(docType, data.layout)
          setDraft(next)
          dirtyRef.current = false
          loadedForTypeRef.current = docType
          queryClient.setQueryData(printKeys.documentLayout(docType), {
            document_type: docType,
            layout: next,
          })
          toast.success(t.print.layout.saved)
        },
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  function runTestPrint(layout: DocumentLayout) {
    testPrint.mutate(
      { documentType: docType, layout, snapshot },
      {
        onSuccess: () => toast.success(t.print.layout.testQueued),
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  function onTestPrint() {
    if (dirtyRef.current) {
      const ok = window.confirm(t.print.layout.testPrintUnsaved)
      if (!ok) return
      save.mutate(
        { documentType: docType, layout: draft },
        {
          onSuccess: (data) => {
            const next = mergeLayout(docType, data.layout)
            setDraft(next)
            dirtyRef.current = false
            loadedForTypeRef.current = docType
            queryClient.setQueryData(printKeys.documentLayout(docType), {
              document_type: docType,
              layout: next,
            })
            toast.success(t.print.layout.saved)
            runTestPrint(next)
          },
          onError: (e: Error) => toast.error(e.message),
        },
      )
      return
    }
    runTestPrint(draft)
  }

  if (layoutQuery.isLoading || settingsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-0">
          <LoadingState />
        </CardContent>
      </Card>
    )
  }

  if (layoutQuery.isError) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState
            description={t.print.layout.loadFailed}
            onRetry={() => void layoutQuery.refetch()}
          />
        </CardContent>
      </Card>
    )
  }

  const scenarios = scenariosForDocumentType(docType)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/30 gap-3 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t.print.layout.heading}</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.print.layout.hintClean}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onTestPrint}
                loading={testPrint.isPending}
              >
                {t.print.layout.testPrint}
              </Button>
              <Button
                type="button"
                onClick={onSave}
                loading={save.isPending}
              >
                {t.common.save}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">
                {t.print.layout.documentType}
              </span>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={docType}
                onChange={(e) => {
                  dirtyRef.current = false
                  setDocType(e.target.value as PrintDocumentType)
                }}
              >
                {PRINT_DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t.print.layout.docTypes[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">
                {t.print.layout.paperWidth}
              </span>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={draft.paper_width_mm}
                onChange={(e) =>
                  markDirty({
                    ...draft,
                    paper_width_mm: Number(e.target.value) as 58 | 80,
                  })
                }
              >
                <option value={58}>58</option>
                <option value={80}>80</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">
                {t.print.layout.scenario}
              </span>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={scenarioId}
                onChange={(e) =>
                  setScenarioId(e.target.value as PreviewScenarioId)
                }
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {scenarioLabels[s.labelKey] ?? s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <Card>
          <CardHeader className="gap-2 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                {t.print.layout.documentElements}
              </CardTitle>
              <Button
                type="button"
                size="sm"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="size-4" />
                {t.print.layout.addElement}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {t.print.layout.documentElementsHint}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            {sortableSectionIds.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-8 text-center text-sm">
                {t.print.layout.emptyDocument}
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={sortableSectionIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {sortableSectionIds.map((sectionId) => {
                      const els = documentElements.get(sectionId) ?? []
                      return (
                        <SortableSectionBlock
                          key={sectionId}
                          sectionId={sectionId}
                          sectionLabel={
                            els[0]?.sectionLabel ?? sectionId
                          }
                          elements={els}
                          selectedKey={selectedKey}
                          onSelect={(el) => {
                            setSelection({
                              sectionId: el.sectionId,
                              fieldId: el.fieldId,
                              fieldLabel: el.fieldLabel,
                              sectionLabel: el.sectionLabel,
                            })
                            setSettingsOpen(true)
                          }}
                          onRemoveField={removeField}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader className="gap-1 pb-2">
            <CardTitle className="text-base">
              {t.print.layout.livePreview}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {t.print.layout.livePreviewHint}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col items-center overflow-x-auto pb-6">
            <ThermalReceiptPreview
              documentType={docType}
              layout={draft}
              snapshot={snapshot}
            />
          </CardContent>
        </Card>
      </div>

      <AddElementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groups={catalog}
        onDocumentKeys={onDocumentKeys}
        onAdd={addItems}
      />

      <ElementSettingsDialog
        open={settingsOpen}
        selection={selection}
        field={selectedField}
        section={selectedSection}
        onOpenChange={(v) => {
          setSettingsOpen(v)
          if (!v) setSelection(null)
        }}
        onSave={({ field, section }) => {
          if (!selection) return
          const sec = draft.sections[selection.sectionId]
          const curField = sec?.fields[selection.fieldId]
          if (!sec || !curField) return
          markDirty({
            ...draft,
            sections: {
              ...draft.sections,
              [selection.sectionId]: {
                ...sec,
                ...(section ?? {}),
                visible: true,
                fields: {
                  ...sec.fields,
                  [selection.fieldId]: { ...curField, ...field },
                },
              },
            },
          })
          setSettingsOpen(false)
          setSelection(null)
          toast.success(t.print.layout.elementSaved)
        }}
        onRemove={() => {
          if (!selection) return
          removeField(selection.sectionId, selection.fieldId)
          toast.success(t.print.layout.elementRemoved)
        }}
      />
    </div>
  )
}
