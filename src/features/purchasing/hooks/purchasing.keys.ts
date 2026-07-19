export const purchasingKeys = {
  all: ['purchasing'] as const,
  suppliers: (activeOnly: boolean) =>
    [...purchasingKeys.all, 'suppliers', activeOnly] as const,
  purchases: () => [...purchasingKeys.all, 'purchases'] as const,
  purchase: (id: string) => [...purchasingKeys.all, 'purchase', id] as const,
}
