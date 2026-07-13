import type { StaffRole } from '@/shared/types/identity'
import { t } from '@/shared/i18n'

const ROLE_PRIORITY: StaffRole[] = [
  'owner',
  'manager',
  'cashier',
  'remote_operator',
  'waiter',
  'kitchen',
]

export function primaryStaffRole(roles: readonly StaffRole[]): StaffRole | null {
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return role
  }
  return roles[0] ?? null
}

export function formatStaffRole(role: StaffRole | null): string {
  if (!role) return '—'
  return t.pos.roles[role]
}
