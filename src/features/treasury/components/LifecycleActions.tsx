import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { t } from '@/shared/i18n'
import type { FinStatus } from '@/features/treasury/types'

type Props = {
  status: FinStatus
  onApprove: () => void
  onReject: () => void
  onReverse: () => void
}

/**
 * F1 lifecycle menu. Pending → approve/reject; executed → reverse. Terminal
 * states (rejected/reversed) expose no actions — records are immutable.
 */
export function LifecycleActions({
  status,
  onApprove,
  onReject,
  onReverse,
}: Props) {
  if (status === 'rejected' || status === 'reversed') {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.treasury.common.actions}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status === 'pending' ? (
          <>
            <DropdownMenuItem onSelect={onApprove}>
              {t.treasury.lifecycle.approve}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReject}>
              {t.treasury.lifecycle.reject}
            </DropdownMenuItem>
          </>
        ) : null}
        {status === 'executed' ? (
          <DropdownMenuItem onSelect={onReverse}>
            {t.treasury.lifecycle.reverse}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
