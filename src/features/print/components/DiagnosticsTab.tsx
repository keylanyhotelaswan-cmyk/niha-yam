import { toast } from 'sonner'
import {
  useDiagnosePrintSystem,
  useEnqueueTestPrint,
  useSyncPrintStationBindings,
} from '@/features/print/hooks/usePrintMutations'
import type { PrintSystemDiagnosis, PrinterRow } from '@/features/print/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
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
import { t } from '@/shared/i18n'
import { useState } from 'react'

type Props = {
  printers: PrinterRow[]
}

export function DiagnosticsTab({ printers }: Props) {
  const diagnose = useDiagnosePrintSystem()
  const sync = useSyncPrintStationBindings()
  const testPrint = useEnqueueTestPrint()
  const [result, setResult] = useState<PrintSystemDiagnosis | null>(null)

  const runCheck = async () => {
    try {
      const data = await diagnose.mutateAsync()
      setResult(data)
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

  const runTestQueue = async () => {
    const cashier =
      printers.find((p) => p.role === 'cashier' && p.is_active) ??
      printers.find((p) => p.is_active)
    if (!cashier) {
      toast.error(t.print.diagnostics.noPrinter)
      return
    }
    try {
      const id = await testPrint.mutateAsync(cashier.id)
      toast.success(t.print.diagnostics.testQueued.replace('{id}', id))
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
              disabled={testPrint.isPending}
            >
              {t.print.diagnostics.testQueue}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>{t.print.diagnostics.result}</CardTitle>
              <Badge variant={result.ready ? 'default' : 'destructive'}>
                {result.ready
                  ? t.print.diagnostics.ready
                  : t.print.diagnostics.notReady}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.checks.map((c) => (
                <div
                  key={c.id}
                  className="border-border flex items-start justify-between gap-3 border-b py-2 text-sm last:border-0"
                >
                  <div>
                    <div className="font-medium">
                      {c.ok ? '✅' : '❌'} {c.label}
                    </div>
                    {c.detail ? (
                      <p className="text-muted-foreground mt-1 text-xs break-all">
                        {c.detail}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={c.ok ? 'secondary' : 'destructive'}>
                    {c.ok ? t.print.common.yes : t.print.common.no}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.print.diagnostics.bridges}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.print.bridges.name}</TableHead>
                    <TableHead>Bridge ID</TableHead>
                    <TableHead>{t.print.common.status}</TableHead>
                    <TableHead>{t.print.health.version}</TableHead>
                    <TableHead>{t.print.health.lastHeartbeat}</TableHead>
                    <TableHead>{t.print.bridges.devices}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.bridges.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.device_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{b.id}</TableCell>
                      <TableCell>
                        {b.online
                          ? t.print.common.online
                          : b.is_active
                            ? t.print.common.offline
                            : t.print.common.inactive}
                      </TableCell>
                      <TableCell>{b.version ?? '—'}</TableCell>
                      <TableCell className="text-xs">
                        {b.last_heartbeat_at ?? '—'}
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
                    <TableHead>{t.print.printers.name}</TableHead>
                    <TableHead>Printer ID</TableHead>
                    <TableHead>Bridge ID</TableHead>
                    <TableHead>Windows</TableHead>
                    <TableHead>{t.print.common.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.printers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.bridge_id ?? '—'}
                      </TableCell>
                      <TableCell>{p.windows_printer_name ?? '—'}</TableCell>
                      <TableCell>
                        {p.bridge_online
                          ? t.print.common.online
                          : t.print.common.offline}
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
                      <TableHead>{t.print.queue.reference}</TableHead>
                      <TableHead>{t.print.common.status}</TableHead>
                      <TableHead>{t.print.diagnostics.rejectReason}</TableHead>
                      <TableHead>Job Bridge</TableHead>
                      <TableHead>Windows</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.pending_jobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell>{j.reference}</TableCell>
                        <TableCell>{j.status}</TableCell>
                        <TableCell className="text-xs">
                          {j.reject_reason}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {j.job_bridge_id ?? '—'}
                        </TableCell>
                        <TableCell>{j.windows_printer_name ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">
            {t.print.diagnostics.empty}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
