import { useQuery } from '@tanstack/react-query'
import { fetchPosContext, fetchPosMenu } from '@/features/pos/api/pos.api'
import { posKeys } from '@/features/pos/hooks/pos.keys'

/** Loaded once per POS session — no refetch after sales (M5 performance rule). */
export function usePosMenu() {
  return useQuery({
    queryKey: posKeys.menu(),
    queryFn: fetchPosMenu,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 8,
  })
}

/** Shift + payment methods — refresh only after shift changes or successful sale. */
export function usePosContext() {
  return useQuery({
    queryKey: posKeys.context(),
    queryFn: fetchPosContext,
    staleTime: 1000 * 60 * 5,
  })
}
