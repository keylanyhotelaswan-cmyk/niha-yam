import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchLiquiditySnapshot,
  releaseReservedLiquidity,
  upsertLiquiditySettings,
} from '@/features/treasury/api/liquidity.api'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'

export function useLiquiditySnapshot() {
  return useQuery({
    queryKey: [...treasuryKeys.all, 'liquidity'],
    queryFn: fetchLiquiditySnapshot,
    staleTime: 5_000,
  })
}

export function useUpsertLiquiditySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertLiquiditySettings,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: treasuryKeys.all })
    },
  })
}

export function useReleaseReserved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string }) =>
      releaseReservedLiquidity(amount, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: treasuryKeys.all })
    },
  })
}
