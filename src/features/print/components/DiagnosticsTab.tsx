import { toast } from 'sonner'
import {
  useChooseCashierWindowsPrinter,
  useDiagnosePrintSystem,
  useEnqueueTestPrint,
  useSetTestingPrintEnabled,
  useSyncPrintStationBindings,
} from '@/features/print/hooks/usePrintMutations'
import { usePrintOpsSettings } from '@/features/print/hooks/usePrintQueries'
import type { PrintSystemDiagnosis, PrinterRow } from '@/features/print/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { isTestingEnv } from '@/shared/config/appEnv'
import { t } from '@/shared/i18n'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

type Props = {
  printers: PrinterRow[]
}

function formatRelativeAr(iso: string | null | undefined): string {
  if (!iso) return t.print.diagnostics.neverUpdated
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return t.print.diagnostics.neverUpdated
  const diffMs = Date.now() - at.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'منذ لحظات'
  if (mins < 60) return `منذ ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `منذ ${hours} ساعة`
  const days = Math.floor(hours / 24)
  if (days < 7) return `منذ ${days} يوم`
  return at.toLocaleString('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function DiagnosticsTab({ printers }: Props) {
  const diagnose = useDiagnosePrintSystem()
  const sync = useSyncPrintStationBindings()
  const choose = useChooseCashierWindowsPrinter()
  const testPrint = useEnqueueTestPrint()
  const setTestingPrint = useSetTestingPrintEnabled()
  const opsQuery = usePrintOpsSettings()
  const [result, setResult] = useState<PrintSystemDiagnosis | null>(null)
  const [picked, setPicked] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const testingUi = isTestingEnv()

  const runCheck = async () => {
    try {
      if (testingUi) {
        try {
          await opsQuery.refetch()
        } catch {
          /* ignore — diagnose still useful */
        }
      }
      const data = await diagnose.mutateAsync()
      setResult(data)
      if (data.print_ops) {
        /* keep ops query in sync after diagnose */
        void opsQuery.refetch()
      }
      const need =
        data.selection?.needs_choice ||
        (data.selection?.candidates?.length ?? 0) > 0
      if (need && data.selection?.candidates?.[0]?.windows_name) {
        setPicked(data.selection.candidates[0].windows_name)
      } else {
        setPicked('')
      }
      if (data.ready) toast.success(t.print.diagnostics.ready)
      else toast.error(t.print.diagnostics.notReady)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const runSync = async () => {
    try {
      const data = await sync.mutateAsync()
      if (data.ok === false) {
        toast.error(data.reason ?? t.print.errors.generic)
        return
      }
      toast.success(
        t.print.diagnostics.synced
          .replace('{updated}', String(data.updated ?? 0))
          .replace('{renamed}', String(data.renamed ?? 0)),
      )
      await runCheck()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const runChoose = async () => {
    if (!picked) return
    try {
      const data = await choose.mutateAsync(picked)
      if (data.ok === false) {
        toast.error(data.reason ?? t.print.errors.generic)
        return
      }
      toast.success(t.print.diagnostics.chooseThermalSaved)
      await runCheck()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const selection = result?.selection
  const candidates = selection?.candidates ?? []
  const printOps = opsQuery.data ?? result?.print_ops ?? null
  const testingPrintArmed = Boolean(printOps?.testing_print_enabled)

  const runTestQueue = async () => {
    if (testingUi && !testingPrintArmed) {
      toast.error(t.print.diagnostics.testingPrintTestQueueBlocked)
      return
    }
    const cashier =
      printers.find((p) => p.role === 'cashier' && p.is_active) ??
      printers.find((p) => p.is_active)
    if (!cashier) {
      toast.error(t.print.diagnostics.noPrinter)
      return
    }
    try {
      await testPrint.mutateAsync(cashier.id)
      toast.success(t.print.diagnostics.testQueued)
      await runCheck()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const toggleTestingPrint = async (enabled: boolean) => {
    if (enabled) {
      const ok = window.confirm(t.print.diagnostics.testingPrintConfirmOn)
      if (!ok) return
    }
    try {
      await setTestingPrint.mutateAsync(enabled)
      if (enabled) {
        toast.warning(t.print.diagnostics.testingPrintToggledOn, {
          duration: 8000,
        })
      } else {
        toast.success(t.print.diagnostics.testingPrintToggledOff)
      }
      await opsQuery.refetch()
      await runCheck()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>{t.print.diagnostics.title}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t.print.diagnostics.hint}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void runCheck()}
              disabled={diagnose.isPending}
            >
              {diagnose.isPending
                ? t.print.diagnostics.checking
                : t.print.diagnostics.runCheck}
            </Button>
            <Button
              variant="outline"
              onClick={() => void runSync()}
              disabled={sync.isPending}
            >
              {t.print.diagnostics.syncStation}
            </Button>
            <Button
              variant="outline"
              onClick={() => void runTestQueue()}
              disabled={
                testPrint.isPending ||
                (testingUi && !testingPrintArmed)
              }
              title={
                testingUi && !testingPrintArmed
                  ? t.print.diagnostics.testingPrintTestQueueBlocked
                  : undefined
              }
            >
              {t.print.diagnostics.testQueue}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {testingUi ? (
        <Card
          className={
            testingPrintArmed
              ? 'border-2 border-red-600 bg-red-50/80 dark:bg-red-950/30'
              : 'border-amber-500/40 bg-amber-500/5'
          }
        >
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t.print.diagnostics.testingPrintTitle}</CardTitle>
              <Badge variant={testingPrintArmed ? 'destructive' : 'secondary'}>
                {testingPrintArmed
                  ? t.print.diagnostics.testingPrintEnabled
                  : t.print.diagnostics.testingPrintDisabled}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {t.print.diagnostics.testingPrintHint}
            </p>
            {!testingPrintArmed ? (
              <p className="text-muted-foreground text-xs">
                {t.print.diagnostics.testingPrintSafeHint}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {t.print.diagnostics.pairTestingHint}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {testingPrintArmed ? (
              <Alert className="border-red-600 bg-red-100/80 dark:bg-red-950/40">
                <AlertTriangle className="size-4 text-red-700" />
                <AlertTitle className="font-bold">
                  {t.print.diagnostics.testingPrintArmedTitle}
                </AlertTitle>
                <AlertDescription>
                  {t.print.diagnostics.testingPrintArmedBody}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-muted-foreground text-xs">
                {t.print.diagnostics.envLabel}: {t.print.diagnostics.envTesting}
              </div>
              <div className="flex flex-wrap gap-2">
                {testingPrintArmed ? (
                  <Button
                    variant="destructive"
                    onClick={() => void toggleTestingPrint(false)}
                    disabled={setTestingPrint.isPending}
                  >
                    {t.print.diagnostics.testingPrintOffNow}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => void toggleTestingPrint(true)}
                    disabled={setTestingPrint.isPending}
                  >
                    {t.print.diagnostics.testingPrintOn}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>{t.print.diagnostics.howChosenTitle}</CardTitle>
              <Badge variant={result.ready ? 'default' : 'destructive'}>
                {result.ready
                  ? t.print.diagnostics.ready
                  : t.print.diagnostics.notReady}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground text-xs">
                    {t.print.diagnostics.envLabel}
                  </div>
                  <div className="mt-1 font-medium">
                    {printOps?.is_test_environment || testingUi
                      ? t.print.diagnostics.envTesting
                      : t.print.diagnostics.envProduction}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground text-xs">
                    {t.print.diagnostics.printerConnectedLabel}
                  </div>
                  <div className="mt-1 font-medium">
                    {selection?.connected
                      ? t.print.diagnostics.connectedYes
                      : t.print.diagnostics.connectedNo}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground text-xs">
                    {t.print.diagnostics.programVersion}
                  </div>
                  <div className="mt-1 font-medium" dir="ltr">
                    {selection?.bridge_version ??
                      t.print.diagnostics.unknownVersion}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground text-xs">
                    {t.print.diagnostics.lastContact}
                  </div>
                  <div className="mt-1 font-medium">
                    {formatRelativeAr(
                      result.online_bridge?.last_heartbeat_at ??
                        selection?.last_remap_at,
                    )}
                  </div>
                </div>
              </div>

              {(testingUi || printOps) && (
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground text-xs">
                    {t.print.diagnostics.testingPrintTitle}
                  </div>
                  <div className="mt-1 font-medium">
                    {printOps?.testing_print_enabled
                      ? t.print.diagnostics.testingPrintEnabled
                      : t.print.diagnostics.testingPrintDisabled}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border p-4">
                <div className="text-muted-foreground text-xs">
                  {t.print.diagnostics.activePrinterLabel}
                </div>
                <div className="mt-1 text-base font-semibold">
                  {selection?.active_printer ??
                    t.print.diagnostics.noActivePrinter}
                </div>
                {selection?.previous_printer &&
                selection.previous_printer !== selection.active_printer ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t.print.diagnostics.remapFrom}:{' '}
                    <span className="line-through">
                      {selection.previous_printer}
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-muted-foreground text-xs">
                  {t.print.diagnostics.whyChosen}
                </div>
                <p className="mt-1 leading-relaxed">
                  {selection?.status_message_ar ??
                    selection?.reason_ar ??
                    '—'}
                </p>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="text-muted-foreground text-xs">
                  {t.print.diagnostics.lastAutoUpdate}
                </div>
                <div className="mt-1 font-medium">
                  {formatRelativeAr(selection?.last_remap_at)}
                </div>
                {selection?.last_remap_from && selection?.last_remap_to ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {selection.last_remap_to} ← {selection.last_remap_from}
                  </p>
                ) : null}
              </div>

              {selection?.needs_choice || candidates.length > 1 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                  <div>
                    <div className="font-medium">
                      {t.print.diagnostics.chooseThermalTitle}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.print.diagnostics.chooseThermalHint}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm sm:max-w-md"
                      value={picked}
                      onChange={(e) => setPicked(e.target.value)}
                    >
                      {candidates.map((c) => (
                        <option key={c.windows_name} value={c.windows_name}>
                          {c.windows_name}
                          {c.is_default ? ' (الافتراضية)' : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      onClick={() => void runChoose()}
                      disabled={!picked || choose.isPending}
                    >
                      {t.print.diagnostics.chooseThermalSave}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>{t.print.diagnostics.result}</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced
                  ? t.print.diagnostics.hideAdvanced
                  : t.print.diagnostics.showAdvanced}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.checks.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{c.label}</div>
                    <p className="text-muted-foreground text-xs">{c.detail}</p>
                  </div>
                  <Badge variant={c.ok ? 'default' : 'destructive'}>
                    {c.ok ? '✓' : '!'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {showAdvanced ? (
            <>
              <p className="text-muted-foreground text-xs">
                {t.print.diagnostics.advancedHint}
              </p>

              <Card>
                <CardHeader>
                  <CardTitle>{t.print.diagnostics.connectionsTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الجهاز</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>الإصدار</TableHead>
                        <TableHead>{t.print.diagnostics.lastContact}</TableHead>
                        <TableHead>طابعات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(result.bridges ?? []).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>{b.device_name ?? '—'}</TableCell>
                          <TableCell>
                            {b.online
                              ? t.print.diagnostics.bridgeOnline
                              : t.print.diagnostics.bridgeOffline}
                          </TableCell>
                          <TableCell dir="ltr">{b.version ?? '—'}</TableCell>
                          <TableCell>
                            {formatRelativeAr(b.last_heartbeat_at)}
                          </TableCell>
                          <TableCell>{b.device_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.print.diagnostics.printers}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الاسم</TableHead>
                        <TableHead>الدور</TableHead>
                        <TableHead>Windows</TableHead>
                        <TableHead>Bridge</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(result.printers ?? []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.role}</TableCell>
                          <TableCell dir="ltr">
                            {p.windows_printer_name ?? '—'}
                          </TableCell>
                          <TableCell>
                            {p.bridge_online ? 'متصل' : 'غير متصل'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {(result.pending_jobs?.length ?? 0) > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t.print.diagnostics.pendingJobs}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>المرجع</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>
                            {t.print.diagnostics.rejectReason}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.pending_jobs.map((j) => (
                          <TableRow key={j.id}>
                            <TableCell>{j.reference}</TableCell>
                            <TableCell>{j.status}</TableCell>
                            <TableCell>{j.reject_reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t.print.diagnostics.empty}
        </p>
      )}
    </div>
  )
}
