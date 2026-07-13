import { useMutation } from '@tanstack/react-query'
import { changeStaffPassword } from '@/features/staff/api/staff.api'

/** Change a staff member's password (Edge Function). No list invalidation (not shown). */
export function useChangeStaffPassword() {
  return useMutation({
    mutationFn: (args: { staffId: string; password: string }) =>
      changeStaffPassword(args.staffId, args.password),
  })
}
