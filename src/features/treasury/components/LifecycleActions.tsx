import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { t } from '@/shared/i18n'
import type { FinStatus } from '@/features/treasury/types'

type Props = {
  status: FinStatus
  onReject: () => void
}

/**
 * Execute-now money lifecycle: pending (legacy) or executed → Reject
 * (reject reverses executed rows server-side). Terminal states are immutable.
 */
export function LifecycleActions({ status, onReject }: Props) {
  if (status === 'rejected' || status === 'reversed') {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  if (status !== 'pending' && status !== 'executed') {
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
        <DropdownMenuItem onSelect={onReject}>
          {t.treasury.lifecycle.reject}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
