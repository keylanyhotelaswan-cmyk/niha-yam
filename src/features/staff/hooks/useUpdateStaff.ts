import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateStaff } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'
import type { DiscountPermissionConfig } from '@/shared/access/discountPermissions'

type UpdateStaffArgs = {
  staffId: string
  displayName: string
  branchId: string
  role: string
  discountPermissions?: DiscountPermissionConfig | null
}

/** Update a staff member's name + role + discount permissions, then invalidate the list. */
export function useUpdateStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: UpdateStaffArgs) => updateStaff(args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.list() })
    },
  })
}
