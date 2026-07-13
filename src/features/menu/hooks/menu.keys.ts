/**
 * Query-key factory for the menu feature (ADR-0014). Hooks and cache
 * invalidations reference these — no ad-hoc key arrays across the code.
 */
export const menuKeys = {
  all: ['menu'] as const,
  admin: () => [...menuKeys.all, 'admin'] as const,
  modifierGroups: () => [...menuKeys.all, 'modifier-groups'] as const,
}
