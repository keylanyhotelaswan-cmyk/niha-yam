import type { StaffBranchAssignment, StaffRole } from '@/shared/types/identity'

export type { StaffBranchAssignment, StaffRole } from '@/shared/types/identity'

export type StaffListItem = {
  id: string
  user_id: string
  username: string | null
  display_name: string
  is_active: boolean
  branches: StaffBranchAssignment[]
  created_at: string
  discount_permissions?: import('@/shared/access/discountPermissions').DiscountPermissionConfig | null
}

export type CreateStaffInput = {
  username: string
  displayName: string
  password: string
  pin?: string | null
  role: StaffRole
  isActive: boolean
  email?: string | null
}
