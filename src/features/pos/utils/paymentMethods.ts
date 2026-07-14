import type { PosPaymentMethod } from '@/features/pos/types'

/** Prefer cash, then sort_order — shared by sell / collect / edit. */
export function sortPaymentMethods(methods: PosPaymentMethod[]): PosPaymentMethod[] {
  return [...methods].sort((a, b) => {
    if (a.code === 'cash' && b.code !== 'cash') return -1
    if (b.code === 'cash' && a.code !== 'cash') return 1
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
}
