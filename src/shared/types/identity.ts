/**
 * Shared identity/domain types used across features (session + staff domain).
 * Feature-owned types stay in their feature (see ADR-0016).
 */

export type StaffRole =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'remote_operator'
  | 'waiter'
  | 'kitchen'

export type StaffBranchAssignment = {
  branch_id: string
  role: StaffRole
  branch_name?: string
  branch_code?: string
}

export type StaffProfile = {
  id: string
  user_id: string
  restaurant_id: string
  username: string | null
  display_name: string
  is_active: boolean
  branches: StaffBranchAssignment[]
  /** Resolved: role default or explicit staff.can_print_manage */
  can_print_manage?: boolean
}
