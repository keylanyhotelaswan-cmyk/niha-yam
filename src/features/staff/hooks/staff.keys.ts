/**
 * Query-key factory for the staff feature. Hooks and cache invalidations
 * reference these — no ad-hoc key arrays scattered across the code (ADR-0014).
 */
export const staffKeys = {
  all: ['staff'] as const,
  list: () => [...staffKeys.all, 'list'] as const,
  branches: () => ['branches', 'list'] as const,
}
