import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/shared/utils/cn'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-4 [&>svg+div]:ps-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive [&>svg]:text-destructive',
        success: 'border-success/50 text-success [&>svg]:text-success',
        warning: 'border-warning/50 text-warning [&>svg]:text-warning',
        info: 'border-info/50 text-info [&>svg]:text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertProps = ComponentProps<'div'> &
  VariantProps<typeof alertVariants>

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'h5'>) {
  return (
    <h5
      className={cn('mb-1 leading-none font-medium tracking-tight', className)}
      {...props}
    />
  )
}

export function AlertDescription({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn('text-sm [&_p]:leading-relaxed', className)}
      {...props}
    />
  )
}
