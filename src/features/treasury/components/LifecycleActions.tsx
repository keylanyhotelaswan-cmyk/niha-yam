import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/i18n'
import type { FinStatus } from '@/features/treasury/types'

type Props = {
  status: FinStatus
  onReject: () => void
  disabled?: boolean
}

/**
 * Execute-now money lifecycle: pending (legacy) or executed → visible Reject
 * (server-side reject reverses executed rows). Terminal states are immutable.
 */
export function LifecycleActions({ status, onReject, disabled }: Props) {
  if (status === 'rejected' || status === 'reversed') {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  if (status !== 'pending' && status !== 'executed') {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="text-destructive border-destructive/40 hover:bg-destructive/5"
      disabled={disabled}
      onClick={onReject}
    >
      {t.treasury.lifecycle.reject}
    </Button>
  )
}
