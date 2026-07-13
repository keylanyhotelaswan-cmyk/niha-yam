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
import { GripVertical } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ThermalReceiptPreview } from '@/features/print/components/ThermalReceiptPreview'
import { useUpsertPrintDocumentLayout, useEnqueueLayoutPreviewPrint } from '@/features/print/hooks/usePrintMutations'
import { printKeys } from '@/features/print/hooks/print.keys'
import {
  usePrintDocumentLayout,
  usePrintSettings,
} from '@/features/print/hooks/usePrintQueries'
import {
  defaultLayoutFor,
  mergeLayout,
  PRINT_DOCUMENT_TYPES,
  SECTION_ALIGNS,
  sectionsForDocumentType,
  type DocumentLayout,
  type FieldStyle,
  type PrintDocumentType,
  type SectionAlign,
  type SectionDef,
  type SectionStyle,
} from '@/features/print/layout/sections'
import { REFERENCE_FIELD_IDS } from '@/features/print/layout/field-text'
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
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

function styleControls(
  style: { font_pt: number; align: SectionAlign; bold: boolean },
  onChange: (patch: Partial<FieldStyle & SectionStyle>) => void,
) {
  return (
    <>
      <div className="space-y-1">
        <Label>{t.print.layout.fontPt}</Label>
        <Input
          type="number"
          min={10}
          max={40}
          value={style.font_pt}
          onChange={(e) =>
            onChange({ font_pt: Number(e.target.value) || style.font_pt })
          }
        />
      </div>
      <div className="space-y-1">
        <Label>{t.print.layout.align}</Label>
        <select
          className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          value={style.align}
          onChange={(e) => onChange({ align: e.target.value as SectionAlign })}
        >
          {SECTION_ALIGNS.map((a) => (
            <option key={a} value={a}>
              {t.print.layout.aligns[a]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={style.bold}
          onChange={(e) => onChange({ bold: e.target.checked })}
        />
        {t.print.layout.bold}
      </label>
    </>
  )
}

function SortableSectionCard({
  def,
  style,
  open,
  onToggle,
  onPatchSection,
  onPatchField,
  labels,
  fieldLabels,
}: {
  def: SectionDef
  style: SectionStyle
  open: boolean
  onToggle: () => void
  onPatchSection: (patch: Partial<SectionStyle>) => void
  onPatchField: (fieldId: string, patch: Partial<FieldStyle>) => void
  labels: Record<string, string>
  fieldLabels: Record<string, string>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: def.id })

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={cn(
        'border-border bg-card rounded-lg border shadow-sm',
        isDragging && 'border-primary z-10 opacity-95 shadow-md',
      )}
    >
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          className="text-muted-foreground hover:bg-muted/60 flex cursor-grab items-center px-2 active:cursor-grabbing"
          aria-label={t.print.layout.dragHandle}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-3 text-start"
          onClick={onToggle}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {labels[def.labelKey] ?? def.id}
            </p>
            <p className="text-muted-foreground text-xs">
              {style.visible ? t.print.layout.visible : t.print.layout.hidden}
              {' · '}
              {style.font_pt}pt
              {' · '}
              {t.print.layout.aligns[style.align]}
              {' · '}
              {def.fields.length} {t.print.layout.fieldsCount}
            </p>
          </div>
          <span className="text-muted-foreground text-xs">{open ? '▾' : '◂'}</span>
        </button>
      </div>

      {open ? (
        <div className="border-border space-y-4 border-t p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={style.visible}
                onChange={(e) => onPatchSection({ visible: e.target.checked })}
              />
              {t.print.layout.sectionVisible}
            </label>
            {styleControls(style, onPatchSection)}
            <div className="space-y-1">
              <Label>{t.print.layout.spaceBefore}</Label>
              <Input
                type="number"
                min={0}
                max={12}
                value={style.space_before}
                onChange={(e) =>
                  onPatchSection({ space_before: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>{t.print.layout.spaceAfter}</Label>
              <Input
                type="number"
                min={0}
                max={12}
                value={style.space_after}
                onChange={(e) =>
                  onPatchSection({ space_after: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t.print.layout.fieldsHeading}</p>
            {def.fields.map((fd) => {
              const field =
                style.fields[fd.id] ??
                ({
                  visible: true,
                  font_pt: style.font_pt,
                  align: style.align,
                  bold: style.bold,
                } satisfies FieldStyle)
              return (
                <div
                  key={fd.id}
                  className="bg-muted/40 space-y-2 rounded-md border p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {fieldLabels[fd.labelKey] ?? fd.id}
                    </span>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={field.visible}
                        onChange={(e) =>
                          onPatchField(fd.id, { visible: e.target.checked })
                        }
                      />
                      {t.print.layout.visible}
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {styleControls(field, (patch) => onPatchField(fd.id, patch))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>{t.print.layout.fieldLabelAr}</Label>
                      <Input
                        className="h-9"
                        placeholder={fieldLabels[fd.labelKey] ?? fd.id}
                        value={field.label_ar ?? ''}
                        onChange={(e) =>
                          onPatchField(fd.id, {
                            label_ar: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t.print.layout.fieldLabelEn}</Label>
                      <Input
                        className="h-9"
                        placeholder="Invoice"
                        dir="ltr"
                        value={field.label_en ?? ''}
                        onChange={(e) =>
                          onPatchField(fd.id, {
                            label_en: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t.print.layout.labelMode}</Label>
                      <select
                        className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                        value={field.label_mode ?? 'ar'}
                        onChange={(e) =>
                          onPatchField(fd.id, {
                            label_mode: e.target
                              .value as FieldStyle['label_mode'],
                          })
                        }
                      >
                        <option value="ar">{t.print.layout.labelModes.ar}</option>
                        <option value="en">{t.print.layout.labelModes.en}</option>
                        <option value="both">
                          {t.print.layout.labelModes.both}
                        </option>
                        <option value="none">
                          {t.print.layout.labelModes.none}
                        </option>
                      </select>
                    </div>
                    {REFERENCE_FIELD_IDS.has(fd.id) ? (
                      <div className="space-y-1">
                        <Label>{t.print.layout.valueFormat}</Label>
                        <select
                          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                          value={field.value_format ?? 'default'}
                          onChange={(e) =>
                            onPatchField(fd.id, {
                              value_format: e.target
                                .value as FieldStyle['value_format'],
                            })
                          }
                        >
                          <option value="default">
                            {t.print.layout.valueFormats.default}
                          </option>
                          <option value="number_only">
                            {t.print.layout.valueFormats.number_only}
                          </option>
                        </select>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    {t.print.layout.fieldLabelHint}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function LayoutTab() {
  const queryClient = useQueryClient()
  const [docType, setDocType] = useState<PrintDocumentType>('receipt')
  const [scenarioId, setScenarioId] = useState<PreviewScenarioId>(
    defaultScenarioId('receipt'),
  )
  const [openId, setOpenId] = useState<string | null>('restaurant_name')
  const layoutQuery = usePrintDocumentLayout(docType)
  const settingsQuery = usePrintSettings()
  const save = useUpsertPrintDocumentLayout()
  const testPrint = useEnqueueLayoutPreviewPrint()

  const [draft, setDraft] = useState<DocumentLayout>(() =>
    defaultLayoutFor('receipt'),
  )
  const dirtyRef = useRef(false)
  const loadedForTypeRef = useRef<string | null>(null)

  useEffect(() => {
    dirtyRef.current = false
    loadedForTypeRef.current = null
  }, [docType])

  useEffect(() => {
    // Don't clobber in-progress edits when a background refetch arrives.
    if (dirtyRef.current && loadedForTypeRef.current === docType) return

    if (!layoutQuery.data?.layout) {
      if (!layoutQuery.isLoading && !layoutQuery.isFetching) {
        setDraft(defaultLayoutFor(docType))
        loadedForTypeRef.current = docType
      }
      return
    }
    setDraft(mergeLayout(docType, layoutQuery.data.layout))
    loadedForTypeRef.current = docType
    dirtyRef.current = false
  }, [
    docType,
    layoutQuery.data,
    layoutQuery.dataUpdatedAt,
    layoutQuery.isLoading,
    layoutQuery.isFetching,
  ])

  useEffect(() => {
    setScenarioId(defaultScenarioId(docType))
    setOpenId(null)
  }, [docType])

  const snapshot = useMemo(() => {
    const settings = settingsQuery.data
    return buildScenarioSnapshot(scenarioId, {
      restaurant_name: undefined,
      slogan: settings?.receipt_slogan,
      restaurant_phone: settings?.restaurant_phone,
      restaurant_address: settings?.restaurant_address,
      thank_you: settings?.thank_you_message,
      show_qr: settings?.show_qr_on_receipt ?? true,
    })
  }, [scenarioId, settingsQuery.data])

  const sectionDefs = sectionsForDocumentType(docType)
  const orderedDefs = draft.section_order
    .map((id) => sectionDefs.find((d) => d.id === id))
    .filter((d): d is SectionDef => Boolean(d))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function markDirty() {
    dirtyRef.current = true
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    markDirty()
    setDraft((prev) => {
      const oldIndex = prev.section_order.indexOf(String(active.id))
      const newIndex = prev.section_order.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return prev
      return {
        ...prev,
        section_order: arrayMove(prev.section_order, oldIndex, newIndex),
      }
    })
  }

  function patchSection(id: string, patch: Partial<SectionStyle>) {
    markDirty()
    setDraft((prev) => {
      const cur = prev.sections[id] ?? defaultLayoutFor(docType).sections[id]!
      const next: SectionStyle = {
        ...cur,
        ...patch,
        fields: patch.fields ?? cur.fields,
      }
      const cascaded = (['font_pt', 'align', 'bold'] as const).some(
        (k) => k in patch && patch[k] !== undefined,
      )
      if (cascaded && !patch.fields) {
        const fields: Record<string, FieldStyle> = {}
        for (const [fid, field] of Object.entries(cur.fields)) {
          fields[fid] = {
            ...field,
            font_pt:
              typeof patch.font_pt === 'number' ? patch.font_pt : field.font_pt,
            align:
              patch.align === 'right' ||
              patch.align === 'center' ||
              patch.align === 'left'
                ? patch.align
                : field.align,
            bold: typeof patch.bold === 'boolean' ? patch.bold : field.bold,
          }
        }
        next.fields = fields
      }
      return {
        ...prev,
        sections: { ...prev.sections, [id]: next },
      }
    })
  }

  function patchField(
    sectionId: string,
    fieldId: string,
    patch: Partial<FieldStyle>,
  ) {
    markDirty()
    setDraft((prev) => {
      const cur =
        prev.sections[sectionId] ??
        defaultLayoutFor(docType).sections[sectionId]!
      const field = cur.fields[fieldId] ?? {
        visible: true,
        font_pt: cur.font_pt,
        align: cur.align,
        bold: cur.bold,
      }
      return {
        ...prev,
        sections: {
          ...prev.sections,
          [sectionId]: {
            ...cur,
            fields: {
              ...cur.fields,
              [fieldId]: { ...field, ...patch },
            },
          },
        },
      }
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

  function runTestPrint() {
    testPrint.mutate(
      { documentType: docType, layout: draft, snapshot },
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
            testPrint.mutate(
              { documentType: docType, layout: next, snapshot },
              {
                onSuccess: () => toast.success(t.print.layout.testQueued),
                onError: (e: Error) => toast.error(e.message),
              },
            )
          },
          onError: (e: Error) => toast.error(e.message),
        },
      )
      return
    }
    runTestPrint()
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

  const labels = t.print.layout.sections as Record<string, string>
  const fieldLabels = t.print.layout.fields as Record<string, string>
  const scenarioLabels = t.print.layout.scenarios as Record<string, string>
  const scenarios = scenariosForDocumentType(docType)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/30 gap-3 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t.print.layout.heading}</CardTitle>
              <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                {t.print.layout.hint}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t.print.layout.reorderHint}
              </p>
            </div>
            <Button type="button" onClick={onSave} loading={save.isPending}>
              {t.print.common.save}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="doc-type">{t.print.layout.documentType}</Label>
              <select
                id="doc-type"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={docType}
                onChange={(e) =>
                  setDocType(e.target.value as PrintDocumentType)
                }
              >
                {PRINT_DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t.print.layout.docTypes[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="scenario">{t.print.layout.scenario}</Label>
              <select
                id="scenario"
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
            </div>
            <div className="space-y-1">
              <Label htmlFor="paper-w">{t.print.layout.paperWidth}</Label>
              <select
                id="paper-w"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={draft.paper_width_mm}
                onChange={(e) => {
                  dirtyRef.current = true
                  setDraft((p) => ({
                    ...p,
                    paper_width_mm: Number(e.target.value) === 58 ? 58 : 80,
                  }))
                }}
              >
                <option value={80}>80</option>
                <option value={58}>58</option>
              </select>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {scenarioLabels[
              scenarios.find((s) => s.id === scenarioId)?.descriptionKey ?? ''
            ] ?? t.print.layout.scenarioHint}
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t.print.layout.sectionsHeading}
            </h3>
            <p className="text-muted-foreground text-xs">
              {t.print.layout.dragHint}
            </p>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={orderedDefs.map((d) => d.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {orderedDefs.map((def) => {
                  const style =
                    draft.sections[def.id] ??
                    defaultLayoutFor(docType).sections[def.id]!
                  return (
                    <SortableSectionCard
                      key={def.id}
                      def={def}
                      style={style}
                      open={openId === def.id}
                      onToggle={() =>
                        setOpenId((cur) => (cur === def.id ? null : def.id))
                      }
                      onPatchSection={(patch) => patchSection(def.id, patch)}
                      onPatchField={(fieldId, patch) =>
                        patchField(def.id, fieldId, patch)
                      }
                      labels={labels}
                      fieldLabels={fieldLabels}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader className="gap-1 pb-2">
            <CardTitle className="text-base">
              {t.print.layout.livePreview}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {t.print.layout.livePreviewHint}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 overflow-x-auto pb-6">
            <ThermalReceiptPreview
              documentType={docType}
              layout={draft}
              snapshot={snapshot}
            />
            <div className="flex w-full flex-col items-center gap-1.5 px-1">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onTestPrint}
                loading={testPrint.isPending}
              >
                {t.print.layout.testPrint}
              </Button>
              <p className="text-muted-foreground text-center text-xs">
                {t.print.layout.testPrintHint}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
