import { useMutation } from '@tanstack/react-query'
import { setStaffPin } from '@/features/staff/api/staff.api'

/** Set a staff member's PIN. No list invalidation (PIN is not shown in the list). */
export function useSetStaffPin() {
  return useMutation({
    mutationFn: (args: { staffId: string; pin: string }) =>
      setStaffPin(args.staffId, args.pin),
  })
}
