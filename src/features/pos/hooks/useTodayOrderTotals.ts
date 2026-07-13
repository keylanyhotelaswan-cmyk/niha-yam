import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchDayCollectionTotals,
  fetchShiftCollectionTotals,
} from '@/features/pos/api/collectionTotals.api'
import type {
  ShiftCollectionStatusTotals,
  ShiftPaymentMethodTotal,
} from '@/features/treasury/components/ShiftSummary'

export type CollectionScope = 'shift' | 'day'

/**
 * Hub strip + shift summary: default = open shift.
 * Day scope only when allowDayScope (reports.view | treasury.manage).
 * Collection status + payment methods share the same RPC scope — never mix day orders into shift view.
 */
export function useCollectionTotals(opts: {
  shiftId?: string | null
  /** When false, day toggle is hidden (cashier default = shift only). */
  allowDayScope?: boolean
}) {
  const shiftId = opts.shiftId ?? null
  const allowDay = opts.allowDayScope ?? false
  const [scope, setScope] = useState<CollectionScope>('shift')

  useEffect(() => {
    // Cashier: always shift. Manager without open shift: day. Else reset to shift.
    if (!allowDay) setScope('shift')
    else if (!shiftId) setScope('day')
    else setScope('shift')
  }, [shiftId, allowDay])

  /** Cashiers never resolve to day — even if shiftId is briefly null. */
  const effectiveScope: CollectionScope = !allowDay
    ? 'shift'
    : !shiftId
      ? 'day'
      : scope

  const totalsQuery = useQuery({
    queryKey: ['collection-totals', effectiveScope, shiftId ?? 'none'],
    queryFn: () =>
      effectiveScope === 'shift' && shiftId
        ? fetchShiftCollectionTotals(shiftId)
        : fetchDayCollectionTotals(),
    refetchInterval: 30_000,
    enabled:
      effectiveScope === 'shift' ? Boolean(shiftId) : allowDay,
  })

  const collectionStatusTotals = useMemo((): ShiftCollectionStatusTotals | null => {
    const raw = totalsQuery.data?.by_collection_status
    return raw ?? null
  }, [totalsQuery.data])

  const paymentMethodTotals = useMemo(
    (): ShiftPaymentMethodTotal[] =>
      totalsQuery.data?.by_payment_method ?? [],
    [totalsQuery.data],
  )

  return {
    collectionStatusTotals,
    paymentMethodTotals,
    totalCollected: totalsQuery.data?.total_collected ?? 0,
    scope: effectiveScope,
    setScope: (next: CollectionScope) => {
      if (next === 'day' && !allowDay) return
      if (next === 'shift' && !shiftId) return
      setScope(next)
    },
    canToggleDay: allowDay && Boolean(shiftId),
    hasOpenShift: Boolean(shiftId),
    isLoading: totalsQuery.isLoading,
  }
}

/** @deprecated Prefer useCollectionTotals */
export function useTodayOrderTotals() {
  return useCollectionTotals({ shiftId: null, allowDayScope: true })
}
