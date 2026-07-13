import { Spinner } from '@/shared/components/ui/spinner'
import { t } from '@/shared/i18n'
import { cn } from '@/shared/utils/cn'

export type LoadingStateProps = {
  label?: string
  className?: string
}

/**
 * Stateless loading state (ADR-0008): centered spinner with an accessible label.
 * No data, no timers, no fetching.
 */
export function LoadingState({
  label = t.patterns.loading.label,
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      <Spinner className="size-6" label={label} />
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  )
}
