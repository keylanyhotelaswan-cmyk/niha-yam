import * as React from 'react'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

const ROLE_ORDER = [
  'owner',
  'manager',
  'cashier',
  'remote_operator',
  'waiter',
  'kitchen',
] as const

/**
 * Feature-local native role picker (single branch — ADR-0017). A shared Select
 * primitive can be extracted in M3 when menus need one repeatedly.
 */
export const RoleSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'border-input bg-background flex h-10 w-full rounded-md border px-3 py-2 text-sm',
      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
      className,
    )}
    {...props}
  >
    {ROLE_ORDER.map((role) => (
      <option key={role} value={role}>
        {t.staff.roles[role]}
      </option>
    ))}
  </select>
))
RoleSelect.displayName = 'RoleSelect'
