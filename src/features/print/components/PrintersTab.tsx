import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { PrinterDialog } from '@/features/print/components/dialogs/PrinterDialog'
import {
  formatWhen,
  roleLabel,
} from '@/features/print/components/print-labels'
import {
  useEnqueueTestPrint,
  useSetPrinterActive,
} from '@/features/print/hooks/usePrintMutations'
import { usePrintBridges } from '@/features/print/hooks/usePrintQueries'
import type { PrinterRow } from '@/features/print/types'
import { Badge } from '@/shared/components/ui/badge'
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
import { t } from '@/shared/i18n'

type Props = { printers: PrinterRow[] }

export function PrintersTab({ printers }: Props) {
  const [dialog, setDialog] = useState<{ printer: PrinterRow | null } | null>(
    null,
  )
  const setActive = useSetPrinterActive()
  const testPrint = useEnqueueTestPrint()
  const bridges = usePrintBridges()

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.print.bridges.heading}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t.print.bridges.hint}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {(bridges.data ?? []).length === 0 ? (
            <EmptyState title={t.print.bridges.empty} />
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
                {(bridges.data ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      {b.display_name}
                      {b.device_name ? (
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
                      {(b.devices ?? []).filter((d) => !d.is_virtual).length}
                    </TableCell>
                    <TableCell>{formatWhen(b.last_heartbeat_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t.print.printers.heading}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t.print.printers.assignHint}
            </p>
          </div>
          <Button size="sm" onClick={() => setDialog({ printer: null })}>
            {t.print.printers.add}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {printers.length === 0 ? (
            <EmptyState title={t.print.printers.empty} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.print.printers.name}</TableHead>
                  <TableHead>{t.print.printers.role}</TableHead>
                  <TableHead>{t.print.printers.bridge}</TableHead>
                  <TableHead>{t.print.printers.windowsPrinter}</TableHead>
                  <TableHead>{t.print.common.status}</TableHead>
                  <TableHead>{t.print.health.lastSuccess}</TableHead>
                  <TableHead className="w-16 text-end">
                    {t.print.common.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {printers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{roleLabel(p.role)}</TableCell>
                    <TableCell>
                      {p.bridge_name ?? t.print.common.none}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate">
                      {p.windows_printer_name ??
                        (typeof p.address?.windows_printer_name === 'string'
                          ? p.address.windows_printer_name
                          : t.print.common.none)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? 'success' : 'secondary'}>
                        {p.is_active
                          ? t.print.common.active
                          : t.print.common.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatWhen(p.last_success_at)}</TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t.print.common.actions}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setDialog({ printer: p })}
                          >
                            {t.print.printers.edit}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              testPrint.mutate(p.id, {
                                onSuccess: () =>
                                  toast.success(t.print.printers.testQueued),
                                onError: (e: Error) => toast.error(e.message),
                              })
                            }
                          >
                            {t.print.printers.testPrint}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              setActive.mutate(
                                { id: p.id, active: !p.is_active },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      t.print.printers.statusChanged,
                                    ),
                                  onError: (e: Error) =>
                                    toast.error(e.message),
                                },
                              )
                            }
                          >
                            {p.is_active
                              ? t.print.printers.deactivate
                              : t.print.printers.activate}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialog ? (
        <PrinterDialog
          printer={dialog.printer}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
        />
      ) : null}
    </div>
  )
}
