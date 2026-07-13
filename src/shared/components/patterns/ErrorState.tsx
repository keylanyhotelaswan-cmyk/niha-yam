import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/i18n'
import { cn } from '@/shared/utils/cn'

export type ErrorStateProps = {
  title?: ReactNode
  description?: ReactNode
  /** When provided, shows a retry button that calls this handler. */
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Stateless error state (ADR-0008): renders a message + optional retry.
 * `onRetry` is owned by the feature (e.g. React Query `refetch`); this
 * component performs no fetching itself.
 */
export function ErrorState({
  title = t.patterns.error.title,
  description = t.patterns.error.description,
  onRetry,
  retryLabel = t.common.retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <span className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
