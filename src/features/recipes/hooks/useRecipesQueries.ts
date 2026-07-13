import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCoverage,
  fetchIngredients,
  fetchMenuItemCost,
  fetchMenuRecipeStatus,
  fetchRecipeCost,
  fetchRecipes,
  fetchUomConversions,
  fetchUoms,
  upsertIngredient,
  upsertRecipe,
  upsertUomConversion,
} from '@/features/recipes/api/recipes.api'
import { recipesKeys } from '@/features/recipes/hooks/recipes.keys'

export function useUoms() {
  return useQuery({
    queryKey: recipesKeys.uoms(),
    queryFn: fetchUoms,
    staleTime: 60_000,
  })
}

export function useUomConversions() {
  return useQuery({
    queryKey: recipesKeys.conversions(),
    queryFn: fetchUomConversions,
    staleTime: 60_000,
  })
}

export function useIngredients() {
  return useQuery({
    queryKey: recipesKeys.ingredients(),
    queryFn: () => fetchIngredients(false),
    staleTime: 30_000,
  })
}

export function useRecipesList() {
  return useQuery({
    queryKey: recipesKeys.list(),
    queryFn: () => fetchRecipes(false),
    staleTime: 30_000,
  })
}

export function useCoverage() {
  return useQuery({
    queryKey: recipesKeys.coverage(),
    queryFn: fetchCoverage,
    staleTime: 15_000,
  })
}

export function useMenuRecipeStatus() {
  return useQuery({
    queryKey: recipesKeys.menuStatus(),
    queryFn: fetchMenuRecipeStatus,
    staleTime: 15_000,
  })
}

export function useRecipeCost(recipeId: string | null) {
  return useQuery({
    queryKey: recipesKeys.cost(recipeId ?? ''),
    queryFn: () => fetchRecipeCost(recipeId!),
    enabled: !!recipeId,
  })
}

export function useMenuItemCost(menuItemId: string | null) {
  return useQuery({
    queryKey: recipesKeys.itemCost(menuItemId ?? ''),
    queryFn: () => fetchMenuItemCost(menuItemId!),
    enabled: !!menuItemId,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: recipesKeys.all })
}

export function useUpsertIngredient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertIngredient,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertRecipe,
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertUomConversion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertUomConversion,
    onSuccess: () => invalidateAll(qc),
  })
}
