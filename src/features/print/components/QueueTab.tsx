import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { CancelJobDialog } from '@/features/print/components/dialogs/CancelJobDialog'
import {
  formatWhen,
  jobStatusBadge,
  kindLabel,
} from '@/features/print/components/print-labels'
import {
  useCancelPrintJob,
  usePrintJobAgain,
  useRetryPrintJob,
} from '@/features/print/hooks/usePrintMutations'
import type {
  PrintBridgeRow,
  PrintJobRow,
  PrinterRow,
} from '@/features/print/types'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/patterns/EmptyState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

const FILTERS = [
  'all',
  'pending',
  'claimed',
  'retry_wait',
  'failed',
  'expired',
  'completed',
  'cancelled',
] as const

type Props = {
  jobs: PrintJobRow[]
  printers?: PrinterRow[]
  bridges?: PrintBridgeRow[]
}

function jobCashierName(job: PrintJobRow): string {
  const snap = job.payload?.data_snapshot
  if (snap && typeof snap === 'object') {
    const s = snap as Record<string, unknown>
    const c = s.cashier ?? s.cashier_name
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return t.print.common.none
}

function jobDeviceLabel(
  job: PrintJobRow,
  printers: PrinterRow[],
  bridges: PrintBridgeRow[],
): string {
  const printer = printers.find((p) => p.id === job.printer_id)
  if (!printer) return t.print.common.none
  const bridge =
    bridges.find((b) => b.id === printer.bridge_id) ??
    (printer.bridge_name
      ? ({ display_name: printer.bridge_name } as PrintBridgeRow)
      : null)
  const device =
    bridge && 'device_name' in bridge && bridge.device_name
      ? bridge.device_name
      : bridge?.display_name ?? printer.bridge_name
  const win =
    printer.windows_printer_name ??
    (typeof printer.address?.windows_printer_name === 'string'
      ? printer.address.windows_printer_name
      : null)
  const parts = [printer.name, device, win].filter(Boolean)
  return parts.length ? parts.join(' · ') : t.print.common.none
}

export function QueueTab({
  jobs,
  printers = [],
  bridges = [],
}: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const retry = useRetryPrintJob()
  const again = usePrintJobAgain()
  const cancel = useCancelPrintJob()

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    if (filter === 'pending') {
      return jobs.filter((j) =>
        ['pending', 'claimed', 'printing', 'retry_wait'].includes(j.status),
      )
    }
    return jobs.filter((j) => j.status === filter)
  }, [jobs, filter])

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>{t.print.queue.heading}</CardTitle>
        <p className="text-muted-foreground text-xs">{t.print.queue.ignoreHint}</p>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant="ghost"
              className={cn(
                'rounded-none border-b-2 border-transparent',
                filter === f && 'border-primary text-primary',
              )}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? t.print.queue.filterAll
                : (t.print.statuses as Record<string, string>)[f] ?? f}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <EmptyState title={t.print.queue.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.print.queue.reference}</TableHead>
                <TableHead>{t.print.queue.kind}</TableHead>
                <TableHead>{t.print.queue.cashier}</TableHead>
                <TableHead>{t.print.queue.device}</TableHead>
                <TableHead>{t.print.common.status}</TableHead>
                <TableHead>{t.print.queue.attempts}</TableHead>
                <TableHead>{t.print.queue.created}</TableHead>
                <TableHead>{t.print.queue.error}</TableHead>
                <TableHead className="w-16 text-end">
                  {t.print.common.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-col gap-0.5">
                      {job.reference}
                      {job.is_reprint ? (
                        <span className="text-muted-foreground text-xs">
                          {t.print.queue.reprint}
                          {job.reprint_reason
                            ? `: ${job.reprint_reason}`
                            : ''}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{kindLabel(job.kind)}</TableCell>
                  <TableCell className="text-sm">{jobCashierName(job)}</TableCell>
                  <TableCell className="max-w-[12rem] text-xs">
                    {jobDeviceLabel(job, printers, bridges)}
                  </TableCell>
                  <TableCell>{jobStatusBadge(job.status)}</TableCell>
                  <TableCell>{job.attempt_count}</TableCell>
                  <TableCell>{formatWhen(job.created_at)}</TableCell>
                  <TableCell className="text-destructive max-w-[10rem] truncate text-xs">
                    {job.last_error ?? t.print.common.none}
                  </TableCell>
                  <TableCell className="text-end">
                    <JobActions
                      job={job}
                      onRetry={() =>
                        retry.mutate(job.id, {
                          onSuccess: () =>
                            toast.success(t.print.queue.retried),
                          onError: (e: Error) => toast.error(e.message),
                        })
                      }
                      onAgain={() =>
                        again.mutate(job.id, {
                          onSuccess: () =>
                            toast.success(t.print.queue.printedAgain),
                          onError: (e: Error) => toast.error(e.message),
                        })
                      }
                      onCancel={() => {
                        setCancelError(null)
                        setCancelId(job.id)
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CancelJobDialog
        open={cancelId != null}
        pending={cancel.isPending}
        submitError={cancelError}
        onOpenChange={(open) => {
          if (!open) setCancelId(null)
        }}
        onConfirm={(reason) => {
          if (!cancelId) return
          cancel.mutate(
            { jobId: cancelId, reason },
            {
              onSuccess: () => {
                toast.success(t.print.queue.cancelled)
                setCancelId(null)
              },
              onError: (e: Error) => setCancelError(e.message),
            },
          )
        }}
      />
    </Card>
  )
}

function JobActions({
  job,
  onRetry,
  onAgain,
  onCancel,
}: {
  job: PrintJobRow
  onRetry: () => void
  onAgain: () => void
  onCancel: () => void
}) {
  const canRetry = ['failed', 'retry_wait', 'cancelled'].includes(job.status)
  const canAgain = ['completed', 'failed', 'cancelled', 'expired'].includes(
    job.status,
  )
  const canCancel = [
    'pending',
    'claimed',
    'printing',
    'retry_wait',
    'failed',
  ].includes(job.status)

  if (!canRetry && !canAgain && !canCancel) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={t.print.common.actions}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-xs">
        {canRetry ? (
          <DropdownMenuItem
            onClick={onRetry}
            className="flex flex-col items-stretch gap-0.5"
          >
            <span className="font-medium">{t.print.queue.retry}</span>
            <span className="text-muted-foreground text-xs whitespace-normal">
              {t.print.queue.retryHint}
            </span>
          </DropdownMenuItem>
        ) : null}
        {canAgain ? (
          <DropdownMenuItem
            onClick={onAgain}
            className="flex flex-col items-stretch gap-0.5"
          >
            <span className="font-medium">{t.print.queue.printAgain}</span>
            <span className="text-muted-foreground text-xs whitespace-normal">
              {t.print.queue.printAgainHint}
            </span>
          </DropdownMenuItem>
        ) : null}
        {canCancel ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCancel}>
              {t.print.queue.cancelJob}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
