import { useState } from 'react'
import { toast } from 'sonner'
import { BridgeDownloadButton } from '@/features/print/components/BridgeDownloadButton'
import { PairBridgeDialog } from '@/features/print/components/dialogs/PairBridgeDialog'
import {
  formatWhen,
  roleLabel,
} from '@/features/print/components/print-labels'
import { useExpireStaleJobs } from '@/features/print/hooks/usePrintMutations'
import type { PrintJobRow, PrinterHealth } from '@/features/print/types'
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

type Props = {
  health: PrinterHealth
  expiredJobs: PrintJobRow[]
}

export function HealthTab({ health, expiredJobs }: Props) {
  const [pairOpen, setPairOpen] = useState(false)
  const expire = useExpireStaleJobs()
  const bridge = health.bridge

  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle>{t.print.download.button}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t.print.download.hint}
            </p>
            <p className="text-muted-foreground text-xs">
              {t.print.download.installSteps}
            </p>
          </div>
          <BridgeDownloadButton />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.print.health.bridgeHeading}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setPairOpen(true)}>
            {t.print.health.pairBridge}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {(health.bridges?.length ?? 0) === 0 && !bridge ? (
            <p className="text-muted-foreground">{t.print.health.noBridge}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.print.bridges.name}</TableHead>
                  <TableHead>{t.print.common.status}</TableHead>
                  <TableHead>{t.print.health.version}</TableHead>
                  <TableHead>{t.print.bridges.devices}</TableHead>
                  <TableHead>{t.print.health.lastHeartbeat}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(health.bridges ?? (bridge ? [bridge] : [])).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      {b.display_name}
                      {'device_name' in b && b.device_name ? (
                        <span className="text-muted-foreground block text-xs">
                          {b.device_name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.online ? 'success' : 'destructive'}>
                        {b.online
                          ? t.print.common.online
                          : t.print.common.offline}
                      </Badge>
                    </TableCell>
                    <TableCell>{b.version ?? t.print.common.none}</TableCell>
                    <TableCell>
                      {'device_count' in b
                        ? (b.device_count as number)
                        : t.print.common.none}
                    </TableCell>
                    <TableCell>{formatWhen(b.last_heartbeat_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-muted-foreground text-xs">{t.print.delivery.note}</p>
          <p className="text-muted-foreground text-xs">{t.print.bridges.execNote}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.print.health.queueHeading}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            loading={expire.isPending}
            onClick={() =>
              expire.mutate(undefined, {
                onSuccess: (n) => toast.success(t.print.health.expiredCount(n)),
                onError: (e: Error) => toast.error(e.message),
              })
            }
          >
            {t.print.health.expireNow}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.print.health.pending} value={health.queue.pending} />
            <Stat label={t.print.health.failed} value={health.queue.failed} />
            <Stat
              label={t.print.health.completedToday}
              value={health.queue.completed_today}
            />
            <Stat label={t.print.health.expired} value={expiredJobs.length} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.print.health.printersHeading}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.print.printers.name}</TableHead>
                <TableHead>{t.print.printers.role}</TableHead>
                <TableHead>{t.print.health.pendingJobs}</TableHead>
                <TableHead>{t.print.health.lastSuccess}</TableHead>
                <TableHead>{t.print.health.lastError}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.printers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {p.name}
                      {!p.is_active ? (
                        <Badge variant="secondary">
                          {t.print.common.inactive}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{roleLabel(p.role)}</TableCell>
                  <TableCell>{p.pending_jobs}</TableCell>
                  <TableCell>{formatWhen(p.last_success_at)}</TableCell>
                  <TableCell className="text-destructive max-w-[12rem] truncate">
                    {p.last_error ?? t.print.common.none}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PairBridgeDialog open={pairOpen} onOpenChange={setPairOpen} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
