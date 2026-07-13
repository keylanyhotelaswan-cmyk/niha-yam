import { useMutation, useQueryClient } from '@tanstack/react-query'
import { setStaffStatus } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'

type SetStatusArgs = { staffId: string; active: boolean; reason?: string }

/** Activate/deactivate a staff member, then invalidate the list. */
export function useSetStaffStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: SetStatusArgs) =>
      setStaffStatus(args.staffId, args.active, args.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.list() })
    },
  })
}
