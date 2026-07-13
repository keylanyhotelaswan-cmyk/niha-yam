import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createStaffAccount } from '@/features/staff/api/staff.api'
import { staffKeys } from '@/features/staff/hooks/staff.keys'
import type { CreateStaffInput } from '@/features/staff/types'

/** Create a staff account (Edge Function), then invalidate the list (no blind refetch). */
export function useCreateStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateStaffInput) => createStaffAccount(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.list() })
    },
  })
}
