import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FieldError } from '@/features/print/components/FieldError'
import { useUpsertPrinter } from '@/features/print/hooks/usePrintMutations'
import { usePrintBridges } from '@/features/print/hooks/usePrintQueries'
import {
  printerSchema,
  type PrinterFormValues,
} from '@/features/print/schemas/print.schemas'
import type { PrinterRow } from '@/features/print/types'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

type Props = {
  printer: PrinterRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function windowsNameFrom(printer: PrinterRow | null | undefined) {
  if (!printer) return ''
  if (typeof printer.windows_printer_name === 'string')
    return printer.windows_printer_name
  const addr = printer.address
  if (addr && typeof addr.windows_printer_name === 'string')
    return addr.windows_printer_name
  return ''
}

function hostFrom(printer: PrinterRow | null | undefined) {
  if (!printer?.address) return ''
  if (typeof printer.address.host === 'string') return printer.address.host
  return ''
}

export function PrinterDialog({ printer, open, onOpenChange }: Props) {
  const isEdit = printer !== null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useUpsertPrinter()
  const bridges = usePrintBridges()

  const form = useForm<PrinterFormValues>({
    resolver: zodResolver(printerSchema) as Resolver<PrinterFormValues>,
    defaultValues: {
      name: '',
      role: 'cashier',
      connection: 'windows_spooler',
      bridgeId: '',
      windowsPrinterName: '',
      address: '',
      paperWidthMm: 80,
      encoding: 'CP864',
      defaultCopies: 1,
      autoCut: true,
      openCashDrawer: false,
      logoUrl: '',
      footerText: '',
      isActive: true,
      sortOrder: 0,
    },
  })

  const connection = useWatch({ control: form.control, name: 'connection' })
  const bridgeId = useWatch({ control: form.control, name: 'bridgeId' })

  const selectedBridge = useMemo(
    () => (bridges.data ?? []).find((b) => b.id === bridgeId),
    [bridges.data, bridgeId],
  )

  const deviceOptions = useMemo(() => {
    const devices = selectedBridge?.devices ?? []
    return devices.filter((d) => !d.is_virtual)
  }, [selectedBridge])

  useEffect(() => {
    if (!open) return
    const rawConn = String(printer?.connection ?? 'windows_spooler')
    const connection: PrinterFormValues['connection'] =
      rawConn === 'network' || rawConn === 'lan_9100'
        ? 'lan_9100'
        : rawConn === 'usb' ||
            rawConn === 'bluetooth' ||
            rawConn === 'windows_spooler'
          ? rawConn
          : 'windows_spooler'
    const paperWidthMm: 58 | 80 =
      printer?.paper_width_mm === 58 ? 58 : 80
    form.reset({
      name: printer?.name ?? '',
      role: (printer?.role as PrinterFormValues['role']) ?? 'cashier',
      connection,
      bridgeId: printer?.bridge_id ?? '',
      windowsPrinterName: windowsNameFrom(printer),
      address: hostFrom(printer),
      paperWidthMm,
      encoding: printer?.encoding ?? 'CP864',
      defaultCopies: printer?.default_copies ?? 1,
      autoCut: printer?.auto_cut ?? true,
      openCashDrawer: printer?.open_cash_drawer ?? false,
      logoUrl: printer?.logo_url ?? '',
      footerText: printer?.footer_text ?? '',
      isActive: printer?.is_active ?? true,
      sortOrder: printer?.sort_order ?? 0,
    })
    setSubmitError(null)
  }, [open, printer, form])

  function onSubmit(values: PrinterFormValues) {
    setSubmitError(null)
    const isSpooler = values.connection === 'windows_spooler'
    const address = isSpooler
      ? { windows_printer_name: values.windowsPrinterName.trim() }
      : { host: values.address.trim() }

    mutation.mutate(
      {
        id: printer?.id ?? null,
        name: values.name,
        role: values.role,
        deviceType: 'thermal',
        connection: values.connection,
        address,
        paperWidthMm: values.paperWidthMm,
        encoding: values.encoding,
        defaultCopies: values.defaultCopies,
        autoCut: values.autoCut,
        openCashDrawer: values.openCashDrawer,
        logoUrl: values.logoUrl || null,
        footerText: values.footerText || null,
        isActive: values.isActive,
        sortOrder: values.sortOrder,
        bridgeId: isSpooler && values.bridgeId ? values.bridgeId : null,
        windowsPrinterName: isSpooler
          ? values.windowsPrinterName.trim()
          : null,
      },
      {
        onSuccess: () => {
          toast.success(
            isEdit ? t.print.printers.updated : t.print.printers.created,
          )
          onOpenChange(false)
        },
        onError: (e: Error) => setSubmitError(e.message),
      },
    )
  }

  const errors = form.formState.errors
  const bridgeList = bridges.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t.print.printers.edit : t.print.printers.add}
          </DialogTitle>
        </DialogHeader>

        <form
          id="printer-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <p className="text-muted-foreground text-xs">
            {t.print.printers.assignHint}
          </p>

          <div className="space-y-2">
            <Label htmlFor="printer-name" required>
              {t.print.printers.name}
            </Label>
            <Input id="printer-name" {...form.register('name')} />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="printer-role">{t.print.printers.role}</Label>
              <select
                id="printer-role"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                {...form.register('role')}
              >
                <option value="cashier">{t.print.roles.cashier}</option>
                <option value="kitchen">{t.print.roles.kitchen}</option>
                <option value="label">{t.print.roles.label}</option>
                <option value="barcode">{t.print.roles.barcode}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-conn">{t.print.printers.connection}</Label>
              <select
                id="printer-conn"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                {...form.register('connection')}
              >
                <option value="windows_spooler">Windows Spooler</option>
                <option value="lan_9100">LAN :9100</option>
                <option value="usb">USB</option>
                <option value="bluetooth">Bluetooth</option>
              </select>
            </div>
          </div>

          {connection === 'windows_spooler' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="printer-bridge" required>
                  {t.print.printers.bridge}
                </Label>
                <select
                  id="printer-bridge"
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                  {...form.register('bridgeId')}
                >
                  <option value="">{t.print.printers.pickBridge}</option>
                  {bridgeList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.display_name}
                      {b.online
                        ? ` · ${t.print.common.online}`
                        : ` · ${t.print.common.offline}`}
                      {b.device_name ? ` · ${b.device_name}` : ''}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.bridgeId?.message} />
                {bridgeList.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {t.print.printers.noBridges}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="printer-win" required>
                  {t.print.printers.windowsPrinter}
                </Label>
                {deviceOptions.length > 0 ? (
                  <select
                    id="printer-win"
                    className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    {...form.register('windowsPrinterName')}
                  >
                    <option value="">{t.print.printers.pickWindowsPrinter}</option>
                    {deviceOptions.map((d) => (
                      <option key={d.id} value={d.windows_name}>
                        {d.windows_name}
                        {d.driver_name ? ` · ${d.driver_name}` : ''}
                        {d.port_name ? ` · ${d.port_name}` : ''}
                        {d.assigned_printer_id &&
                        d.assigned_printer_id !== printer?.id
                          ? ` · ${t.print.printers.alreadyAssigned}`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="printer-win"
                    placeholder={t.print.printers.windowsPrinterManual}
                    {...form.register('windowsPrinterName')}
                  />
                )}
                <FieldError message={errors.windowsPrinterName?.message} />
                <p className="text-muted-foreground text-xs">
                  {t.print.printers.windowsPrinterHint}
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="printer-address" required>
                {t.print.printers.address}
              </Label>
              <Input id="printer-address" {...form.register('address')} />
              <FieldError message={errors.address?.message} />
              <p className="text-muted-foreground text-xs">
                {t.print.printers.addressHintLan}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="printer-width">{t.print.printers.paperWidth}</Label>
              <select
                id="printer-width"
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                {...form.register('paperWidthMm', { valueAsNumber: true })}
              >
                <option value={58}>58</option>
                <option value={80}>80</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="printer-copies">{t.print.printers.copies}</Label>
              <Input
                id="printer-copies"
                type="number"
                min={1}
                max={5}
                {...form.register('defaultCopies', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="printer-encoding">{t.print.printers.encoding}</Label>
            <Input id="printer-encoding" {...form.register('encoding')} />
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('autoCut')} />
              {t.print.printers.autoCut}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('openCashDrawer')} />
              {t.print.printers.openDrawer}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...form.register('isActive')} />
              {t.print.common.active}
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="printer-logo">{t.print.printers.logoUrl}</Label>
            <Input id="printer-logo" {...form.register('logoUrl')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="printer-footer">{t.print.printers.footerText}</Label>
            <Input id="printer-footer" {...form.register('footerText')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="printer-sort">{t.print.printers.sortOrder}</Label>
            <Input
              id="printer-sort"
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.print.common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="submit"
            form="printer-form"
            loading={mutation.isPending}
          >
            {t.print.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
