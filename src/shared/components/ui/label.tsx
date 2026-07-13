import type { LabelHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  /** Renders a required marker (*) after the label text. */
  required?: boolean
  children?: ReactNode
}

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        'text-sm leading-none font-medium peer-disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden className="text-destructive ms-1">
          *
        </span>
      ) : null}
    </label>
  )
}
