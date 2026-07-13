import {
  formatWhen,
  jobStatusBadge,
  kindLabel,
} from '@/features/print/components/print-labels'
import type { PrintJobRow } from '@/features/print/types'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
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

type Props = { jobs: PrintJobRow[] }

/** Job history from list_print_jobs (no separate attempts RPC in M6). */
export function LogsTab({ jobs }: Props) {
  const history = jobs.filter((j) =>
    ['completed', 'failed', 'cancelled', 'expired'].includes(j.status),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.print.logs.heading}</CardTitle>
        <p className="text-muted-foreground text-xs">{t.print.delivery.note}</p>
      </CardHeader>
      <CardContent className="p-0">
        {history.length === 0 ? (
          <EmptyState title={t.print.logs.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.print.queue.reference}</TableHead>
                <TableHead>{t.print.queue.kind}</TableHead>
                <TableHead>{t.print.common.status}</TableHead>
                <TableHead>{t.print.queue.attempts}</TableHead>
                <TableHead>{t.print.queue.created}</TableHead>
                <TableHead>{t.print.logs.completedAt}</TableHead>
                <TableHead>{t.print.queue.error}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    {job.reference}
                    {job.is_reprint ? (
                      <span className="text-muted-foreground ms-2 text-xs">
                        ({t.print.queue.reprint})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{kindLabel(job.kind)}</TableCell>
                  <TableCell>{jobStatusBadge(job.status)}</TableCell>
                  <TableCell>{job.attempt_count}</TableCell>
                  <TableCell>{formatWhen(job.created_at)}</TableCell>
                  <TableCell>{formatWhen(job.completed_at)}</TableCell>
                  <TableCell className="text-destructive max-w-[12rem] truncate text-xs">
                    {job.last_error ?? t.print.common.none}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
