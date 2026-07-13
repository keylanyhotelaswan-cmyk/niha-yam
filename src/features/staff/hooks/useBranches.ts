import { useQuery } from '@tanstack/react-query'
import { listBranches } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'

/**
 * Branches query — reference data used only by the invite dialog.
 * `enabled` defers the request until it is actually needed (ADR-0010:
 * every request must have a reason; avoid unnecessary requests).
 */
export function useBranches(enabled: boolean) {
  return useQuery({
    queryKey: staffKeys.branches(),
    queryFn: listBranches,
    enabled,
  })
}
