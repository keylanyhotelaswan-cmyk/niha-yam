import type { ComponentProps } from 'react'
import { cn } from '@/shared/utils/cn'

/**
 * Semantic table primitives — composition-friendly wrappers only.
 * No pagination, sorting, filtering, or selection (see ADR-0008).
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-auto">
      <table
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('hover:bg-muted/30 border-b transition-colors', className)}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-10 px-4 text-start align-middle font-medium',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />
}

export function TableCaption({
  className,
  ...props
}: ComponentProps<'caption'>) {
  return (
    <caption
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  )
}
