import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { t } from '@/shared/i18n'
import { cn } from '@/shared/utils/cn'

export type EmptyStateProps = {
  icon?: ComponentType<LucideProps>
  title?: ReactNode
  description?: ReactNode
  /** Optional CTA slot (e.g. a Button). */
  action?: ReactNode
  className?: string
}

/**
 * Stateless empty state (ADR-0008): does not know why it is empty.
 * The feature passes copy + action.
 */
export function EmptyState({
  icon: Icon,
  title = t.patterns.empty.title,
  description = t.patterns.empty.description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <Icon className="size-6" aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
