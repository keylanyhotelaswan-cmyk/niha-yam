import { Loader2 } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/shared/utils/cn'

export type SpinnerProps = ComponentProps<typeof Loader2> & {
  /** Accessible label; when omitted the spinner is decorative (aria-hidden). */
  label?: string
}

export function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <Loader2
      className={cn('size-4 animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    />
  )
}
