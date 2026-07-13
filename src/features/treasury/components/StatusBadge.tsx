import { Badge } from '@/shared/components/ui/badge'
import { t } from '@/shared/i18n'
import type { FinStatus } from '@/features/treasury/types'

const VARIANT: Record<
  FinStatus,
  'warning' | 'success' | 'secondary' | 'destructive'
> = {
  pending: 'warning',
  approved: 'success',
  executed: 'success',
  rejected: 'destructive',
  reversed: 'secondary',
}

export function StatusBadge({ status }: { status: FinStatus }) {
  return <Badge variant={VARIANT[status]}>{t.treasury.status[status]}</Badge>
}
