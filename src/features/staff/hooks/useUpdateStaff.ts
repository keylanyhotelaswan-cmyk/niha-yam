import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateStaff } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'

type UpdateStaffArgs = {
  staffId: string
  displayName: string
  branchId: string
  role: string
}

/** Update a staff member's name + role, then invalidate the list. */
export function useUpdateStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: UpdateStaffArgs) => updateStaff(args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.list() })
    },
  })
}
