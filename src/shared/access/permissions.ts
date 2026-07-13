import { useMemo } from 'react'
import { useSession } from '@/shared/session/SessionProvider'
import type { StaffRole } from '@/shared/types/identity'

/**
 * Capability-style permissions. Navigation visibility and (as defense-in-depth)
 * route guards are both driven from this set. New modules extend the union.
 *
 * F2 (ADR-0012) will swap the source of `permissions` behind this same API
 * without changing any consumer.
 */
export type Permission =
  | 'dashboard.view'
  | 'pos.access'
  | 'call_center.access'
  | 'staff.manage'
  | 'menu.manage'
  | 'treasury.manage'
  | 'orders.review'
  | 'print.manage'
  | 'reports.view'
  | 'recipes.manage'
  | 'inventory.manage'
  | 'design_system.view'
  | 'diagnostics.view'

const MANAGER_ROLES: readonly StaffRole[] = ['owner', 'manager']

/** Pure role → permission mapping (single place to evolve authorization). */
export function computePermissions(
  roles: readonly StaffRole[],
): Set<Permission> {
  const permissions = new Set<Permission>()
  if (roles.length === 0) return permissions

  permissions.add('dashboard.view')
  permissions.add('pos.access')

  if (roles.includes('remote_operator')) {
    permissions.add('call_center.access')
  }

  if (roles.some((role) => MANAGER_ROLES.includes(role))) {
    permissions.add('call_center.access')
    permissions.add('staff.manage')
    permissions.add('menu.manage')
    permissions.add('treasury.manage')
    permissions.add('orders.review')
    permissions.add('print.manage')
    permissions.add('reports.view')
    permissions.add('recipes.manage')
    permissions.add('inventory.manage')
    permissions.add('design_system.view')
    permissions.add('diagnostics.view')
  }

  return permissions
}

export function usePermissions() {
  const { staff } = useSession()
  return useMemo(() => {
    const roles = staff?.branches.map((branch) => branch.role) ?? []
    const permissions = computePermissions(roles)
    return {
      permissions,
      can: (permission: Permission) => permissions.has(permission),
    }
  }, [staff])
}
