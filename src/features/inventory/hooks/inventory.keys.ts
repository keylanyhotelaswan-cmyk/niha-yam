export const inventoryKeys = {
  all: ['inventory'] as const,
  locations: () => [...inventoryKeys.all, 'locations'] as const,
  levels: () => [...inventoryKeys.all, 'levels'] as const,
  dashboard: () => [...inventoryKeys.all, 'dashboard'] as const,
  card: (id: string) => [...inventoryKeys.all, 'card', id] as const,
}
