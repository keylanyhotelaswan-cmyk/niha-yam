import { useEffect, useRef } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/print/components/FieldError'
import { useUpsertPrintSettings } from '@/features/print/hooks/usePrintMutations'
import {
  printSettingsSchema,
  type PrintSettingsFormValues,
} from '@/features/print/schemas/print.schemas'
import type { PrintSettings } from '@/features/print/types'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

type Props = { settings: PrintSettings }

type SettingsExportFile = {
  export_type: 'niha_print_settings'
  version: 1
  exported_at: string
  settings: PrintSettingsFormValues
}

export function SettingsTab({ settings }: Props) {
  const mutation = useUpsertPrintSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const form = useForm<PrintSettingsFormValues>({
    resolver: zodResolver(printSettingsSchema) as Resolver<PrintSettingsFormValues>,
    defaultValues: toForm(settings),
  })

  useEffect(() => {
    form.reset(toForm(settings))
  }, [settings, form])

  function saveValues(values: PrintSettingsFormValues, successMsg: string) {
    mutation.mutate(
      {
        printJobTtlMinutes: values.printJobTtlMinutes,
        defaultCopies: values.defaultCopies,
        paperWidthMm: values.paperWidthMm,
        openCashDrawer: values.openCashDrawer,
        autoCut: values.autoCut,
        showQrOnReceipt: values.showQrOnReceipt,
        kitchenShowPrices: false,
        thankYouMessage: values.thankYouMessage || null,
        receiptSlogan: values.receiptSlogan || null,
        restaurantPhone: values.restaurantPhone || null,
        restaurantAddress: values.restaurantAddress || null,
        fontTitlePt: values.fontTitlePt,
        fontBodyPt: values.fontBodyPt,
        fontTotalPt: values.fontTotalPt,
      },
      {
        onSuccess: () => toast.success(successMsg),
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  function onSubmit(values: PrintSettingsFormValues) {
    saveValues(values, t.print.settings.saved)
  }

  function onExport() {
    const payload: SettingsExportFile = {
      export_type: 'niha_print_settings',
      version: 1,
      exported_at: new Date().toISOString(),
      settings: form.getValues(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `niha-print-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t.print.settings.exported)
  }

  async function onImportFile(file: File) {
    try {
      const text = await file.text()
      const raw = JSON.parse(text) as Partial<SettingsExportFile>
      const candidate =
        raw.export_type === 'niha_print_settings' && raw.settings
          ? raw.settings
          : (raw as unknown as PrintSettingsFormValues)
      const parsed = printSettingsSchema.safeParse(candidate)
      if (!parsed.success) {
        toast.error(t.print.settings.importInvalid)
        return
      }
      form.reset(parsed.data)
      saveValues(parsed.data, t.print.settings.imported)
    } catch {
      toast.error(t.print.settings.importInvalid)
    }
  }

  const errors = form.formState.errors

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{t.print.settings.heading}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onExport}>
            {t.print.settings.export}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            {t.print.settings.import}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onImportFile(file)
            }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <form className="max-w-lg space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="ttl">{t.print.settings.ttl}</Label>
            <select
              id="ttl"
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              {...form.register('printJobTtlMinutes', { valueAsNumber: true })}
            >
              <option value={2}>{t.print.settings.ttl2}</option>
              <option value={5}>{t.print.settings.ttl5}</option>
              <option value={10}>{t.print.settings.ttl10}</option>
              <option value={0}>{t.print.settings.ttlNever}</option>
            </select>
            <p className="text-muted-foreground text-xs">
              {t.print.settings.ttlHint}
            </p>
            <FieldError message={errors.printJobTtlMinutes?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="copies">{t.print.settings.defaultCopies}</Label>
              <Input
                id="copies"
                type="number"
                min={1}
                max={5}
                {...form.register('defaultCopies', { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="width">{t.print.settings.paperWidth}</Label>
              <select
                id="width"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                {...form.register('paperWidthMm', { valueAsNumber: true })}
              >
                <option value={58}>58</option>
                <option value={80}>80</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('openCashDrawer')} />
              {t.print.settings.openDrawer}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('autoCut')} />
              {t.print.settings.autoCut}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('showQrOnReceipt')} />
              {t.print.settings.showQr}
            </label>
            <label className="text-muted-foreground flex items-center gap-2">
              <input type="checkbox" checked={false} disabled readOnly />
              {t.print.settings.kitchenPrices}
            </label>
            <p className="text-muted-foreground text-xs">
              {t.print.settings.kitchenPricesLocked}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t.print.settings.brandingHeading}</Label>
            <p className="text-muted-foreground text-xs">
              {t.print.settings.brandingHint}
            </p>
            <div className="space-y-2">
              <Label htmlFor="slogan">{t.print.settings.slogan}</Label>
              <Input id="slogan" {...form.register('receiptSlogan')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rest-phone">{t.print.settings.restaurantPhone}</Label>
              <Input id="rest-phone" {...form.register('restaurantPhone')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rest-addr">{t.print.settings.restaurantAddress}</Label>
              <Input id="rest-addr" {...form.register('restaurantAddress')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="thanks">{t.print.settings.thankYou}</Label>
              <Input id="thanks" {...form.register('thankYouMessage')} />
            </div>
            <p className="text-muted-foreground text-xs">
              {t.print.settings.layoutHint}
            </p>
          </div>

          <Button type="submit" loading={mutation.isPending}>
            {t.print.common.save}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function toForm(settings: PrintSettings): PrintSettingsFormValues {
  const ttl = settings.print_job_ttl_minutes
  const printJobTtlMinutes =
    ttl === 0 || ttl === 2 || ttl === 5 || ttl === 10 ? ttl : 5
  return {
    printJobTtlMinutes,
    defaultCopies: settings.default_copies,
    paperWidthMm: settings.paper_width_mm === 58 ? 58 : 80,
    openCashDrawer: settings.open_cash_drawer,
    autoCut: settings.auto_cut,
    showQrOnReceipt: settings.show_qr_on_receipt,
    thankYouMessage: settings.thank_you_message ?? '',
    receiptSlogan: settings.receipt_slogan ?? '',
    restaurantPhone: settings.restaurant_phone ?? '',
    restaurantAddress: settings.restaurant_address ?? '',
    fontTitlePt: settings.font_title_pt ?? 28,
    fontBodyPt: settings.font_body_pt ?? 17,
    fontTotalPt: settings.font_total_pt ?? 24,
  }
}
