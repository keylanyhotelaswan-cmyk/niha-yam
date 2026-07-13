/**
 * Query-key factory for the treasury feature (ADR-0014). Money mutations
 * invalidate `treasuryKeys.all`, so balances/lists refresh together — the
 * ledger is the single source of truth and stays consistent everywhere.
 */
export const treasuryKeys = {
  all: ['treasury'] as const,
  balances: () => [...treasuryKeys.all, 'balances'] as const,
  openShift: () => [...treasuryKeys.all, 'open-shift'] as const,
  ledger: (treasuryId: string) =>
    [...treasuryKeys.all, 'ledger', treasuryId] as const,
  treasuries: () => [...treasuryKeys.all, 'treasuries'] as const,
  paymentMethods: () => [...treasuryKeys.all, 'payment-methods'] as const,
  transfers: () => [...treasuryKeys.all, 'transfers'] as const,
  expenses: () => [...treasuryKeys.all, 'expenses'] as const,
  adjustments: () => [...treasuryKeys.all, 'adjustments'] as const,
  pendingHandovers: () => [...treasuryKeys.all, 'pending-handovers'] as const,
  shiftsArchive: () => [...treasuryKeys.all, 'shifts-archive'] as const,
  shiftArchive: (id: string) =>
    [...treasuryKeys.all, 'shift-archive', id] as const,
}
