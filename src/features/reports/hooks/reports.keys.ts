export const reportsKeys = {
  all: ['reports'] as const,
  today: () => [...reportsKeys.all, 'today'] as const,
  sales: (from: string, to: string) =>
    [...reportsKeys.all, 'sales', from, to] as const,
  expenses: (from: string, to: string) =>
    [...reportsKeys.all, 'expenses', from, to] as const,
  ledger: (treasuryId: string, from: string, to: string) =>
    [...reportsKeys.all, 'ledger', treasuryId, from, to] as const,
  shifts: (from: string, to: string) =>
    [...reportsKeys.all, 'shifts', from, to] as const,
  shift: (id: string) => [...reportsKeys.all, 'shift', id] as const,
  orders: (from: string, to: string) =>
    [...reportsKeys.all, 'orders', from, to] as const,
  delivery: (from: string, to: string) =>
    [...reportsKeys.all, 'delivery', from, to] as const,
  items: (from: string, to: string) =>
    [...reportsKeys.all, 'items', from, to] as const,
  print: (from: string, to: string) =>
    [...reportsKeys.all, 'print', from, to] as const,
}
