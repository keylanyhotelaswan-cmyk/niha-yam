import { useEffect, useState } from 'react'
import { REFERENCE_FIELD_IDS } from '@/features/print/layout/field-text'
import {
  FIELD_LABEL_MODES,
  FIELD_VALUE_FORMATS,
  SECTION_ALIGNS,
  type FieldLabelMode,
  type FieldStyle,
  type FieldValueFormat,
  type SectionAlign,
  type SectionStyle,
} from '@/features/print/layout/sections'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

export type ElementSelection = {
  sectionId: string
  fieldId: string
  fieldLabel: string
  sectionLabel: string
}

type Props = {
  open: boolean
  selection: ElementSelection | null
  field: FieldStyle | null
  section: SectionStyle | null
  onOpenChange: (open: boolean) => void
  onSave: (patch: {
    field: Partial<FieldStyle>
    section?: Partial<SectionStyle>
  }) => void
  onRemove: () => void
}

export function ElementSettingsDialog({
  open,
  selection,
  field,
  section,
  onOpenChange,
  onSave,
  onRemove,
}: Props) {
  const [labelAr, setLabelAr] = useState('')
  const [labelMode, setLabelMode] = useState<FieldLabelMode>('ar')
  const [fontPt, setFontPt] = useState(16)
  const [bold, setBold] = useState(false)
  const [align, setAlign] = useState<SectionAlign>('right')
  const [valueFormat, setValueFormat] = useState<FieldValueFormat>('default')
  const [spaceBefore, setSpaceBefore] = useState(0)
  const [spaceAfter, setSpaceAfter] = useState(0)

  useEffect(() => {
    if (!field) return
    setLabelAr(field.label_ar ?? '')
    setLabelMode(field.label_mode ?? 'ar')
    setFontPt(field.font_pt)
    setBold(field.bold)
    setAlign(field.align)
    setValueFormat(field.value_format ?? 'default')
    if (section) {
      setSpaceBefore(section.space_before)
      setSpaceAfter(section.space_after)
    }
  }, [field, section, selection?.fieldId, selection?.sectionId])

  if (!selection || !field) return null

  const isRef = REFERENCE_FIELD_IDS.has(selection.fieldId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{selection.fieldLabel}</DialogTitle>
          <DialogDescription>
            {selection.sectionLabel} · {t.print.layout.elementSettingsHint}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>{t.print.layout.fieldLabelAr}</Label>
            <Input
              value={labelAr}
              onChange={(e) => setLabelAr(e.target.value)}
              placeholder={t.print.layout.fieldLabelHint}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label>{t.print.layout.labelMode}</Label>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={labelMode}
              onChange={(e) => setLabelMode(e.target.value as FieldLabelMode)}
            >
              {FIELD_LABEL_MODES.map((m) => (
                <option key={m} value={m}>
                  {t.print.layout.labelModes[m]}
                </option>
              ))}
            </select>
          </div>

          <p className="text-muted-foreground sm:col-span-2 text-xs">
            {t.print.layout.printIfHasValueHint}
          </p>

          <div className="space-y-1">
            <Label>{t.print.layout.fontPt}</Label>
            <Input
              type="number"
              min={10}
              max={40}
              value={fontPt}
              onChange={(e) => setFontPt(Number(e.target.value) || fontPt)}
            />
          </div>

          <div className="space-y-1">
            <Label>{t.print.layout.align}</Label>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={align}
              onChange={(e) => setAlign(e.target.value as SectionAlign)}
            >
              {SECTION_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {t.print.layout.aligns[a]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={bold}
              onChange={(e) => setBold(e.target.checked)}
            />
            {t.print.layout.bold}
          </label>

          {isRef ? (
            <div className="space-y-1 sm:col-span-2">
              <Label>{t.print.layout.valueFormat}</Label>
              <select
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                value={valueFormat}
                onChange={(e) =>
                  setValueFormat(e.target.value as FieldValueFormat)
                }
              >
                {FIELD_VALUE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t.print.layout.valueFormats[f]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label>{t.print.layout.spaceBefore}</Label>
            <Input
              type="number"
              min={0}
              max={12}
              value={spaceBefore}
              onChange={(e) => setSpaceBefore(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.print.layout.spaceAfter}</Label>
            <Input
              type="number"
              min={0}
              max={12}
              value={spaceAfter}
              onChange={(e) => setSpaceAfter(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={onRemove}>
            {t.print.layout.removeFromDocument}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={() =>
                onSave({
                  field: {
                    label_ar: labelAr,
                    label_mode: labelMode,
                    font_pt: fontPt,
                    bold,
                    align,
                    ...(isRef ? { value_format: valueFormat } : {}),
                    visible: true,
                  },
                  section: {
                    space_before: spaceBefore,
                    space_after: spaceAfter,
                    visible: true,
                  },
                })
              }
            >
              {t.common.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
