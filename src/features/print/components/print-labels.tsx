import { Badge } from '@/shared/components/ui/badge'
import { t } from '@/shared/i18n'
import type { PrintJobStatus } from '@/features/print/types'

export function jobStatusBadge(status: PrintJobStatus) {
  const label =
    (t.print.statuses as Record<string, string>)[status] ?? status
  const variant =
    status === 'completed'
      ? 'success'
      : status === 'failed' || status === 'expired'
        ? 'destructive'
        : status === 'cancelled'
          ? 'secondary'
          : status === 'retry_wait' || status === 'claimed' || status === 'printing'
            ? 'warning'
            : 'info'
  return <Badge variant={variant}>{label}</Badge>
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return t.print.common.none
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function roleLabel(role: string): string {
  return (t.print.roles as Record<string, string>)[role] ?? role
}

export function kindLabel(kind: string): string {
  return (t.print.kinds as Record<string, string>)[kind] ?? kind
}
