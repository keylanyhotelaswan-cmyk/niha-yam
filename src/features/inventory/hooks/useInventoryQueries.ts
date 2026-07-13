import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchInventoryDashboard,
  fetchInvLocations,
  fetchStockCard,
  fetchStockLevels,
  postStockMovement,
  reverseStockMovement,
  upsertStockSettings,
} from '@/features/inventory/api/inventory.api'
import { inventoryKeys } from '@/features/inventory/hooks/inventory.keys'

export function useInvLocations() {
  return useQuery({
    queryKey: inventoryKeys.locations(),
    queryFn: fetchInvLocations,
    staleTime: 60_000,
  })
}

export function useStockLevels() {
  return useQuery({
    queryKey: inventoryKeys.levels(),
    queryFn: fetchStockLevels,
    staleTime: 15_000,
  })
}

export function useInventoryDashboard() {
  return useQuery({
    queryKey: inventoryKeys.dashboard(),
    queryFn: fetchInventoryDashboard,
    staleTime: 15_000,
  })
}

export function useStockCard(ingredientId: string | null) {
  return useQuery({
    queryKey: inventoryKeys.card(ingredientId ?? ''),
    queryFn: () => fetchStockCard(ingredientId!),
    enabled: !!ingredientId,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: inventoryKeys.all })
}

export function usePostStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postStockMovement,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useReverseStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      movementId,
      reason,
    }: {
      movementId: string
      reason?: string
    }) => reverseStockMovement(movementId, reason),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertStockSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      ingredientId,
      reorderLevel,
    }: {
      ingredientId: string
      reorderLevel: number
    }) => upsertStockSettings(ingredientId, reorderLevel),
    onSuccess: () => invalidateAll(qc),
  })
}
