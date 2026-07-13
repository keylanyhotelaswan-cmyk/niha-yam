export const recipesKeys = {
  all: ['recipes'] as const,
  uoms: () => [...recipesKeys.all, 'uoms'] as const,
  conversions: () => [...recipesKeys.all, 'conversions'] as const,
  ingredients: () => [...recipesKeys.all, 'ingredients'] as const,
  list: () => [...recipesKeys.all, 'list'] as const,
  coverage: () => [...recipesKeys.all, 'coverage'] as const,
  menuStatus: () => [...recipesKeys.all, 'menuStatus'] as const,
  cost: (recipeId: string) => [...recipesKeys.all, 'cost', recipeId] as const,
  itemCost: (menuItemId: string) =>
    [...recipesKeys.all, 'itemCost', menuItemId] as const,
}
