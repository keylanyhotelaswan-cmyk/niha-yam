import * as React from 'react'
import { cn } from '@/shared/utils/cn'

export type InputProps = React.ComponentProps<'input'>

export function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  )
}
