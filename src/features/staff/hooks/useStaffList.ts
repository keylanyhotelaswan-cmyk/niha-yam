import { useQuery } from '@tanstack/react-query'
import { listStaff } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'

/** Staff list query. Single source for the team table. */
export function useStaffList() {
  return useQuery({
    queryKey: staffKeys.list(),
    queryFn: listStaff,
  })
}
