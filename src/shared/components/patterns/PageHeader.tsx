import type { ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

export type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned action slot (buttons, etc.). */
  actions?: ReactNode
  className?: string
}

/**
 * Stateless page header (ADR-0008): renders only what it receives.
 * No data, no fetching, no business logic.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
