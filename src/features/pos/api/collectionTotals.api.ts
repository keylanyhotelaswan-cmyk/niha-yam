import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  ShiftCollectionStatusTotals,
  ShiftPaymentMethodTotal,
} from '@/features/treasury/components/ShiftSummary'

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

function wrap(error: { message: string }): Error {
  return new Error(error.message || t.orders.errors.generic)
}

export type CollectionTotals = {
  scope: 'shift' | 'day'
  shift_id?: string
  date?: string
  by_payment_method: ShiftPaymentMethodTotal[]
  by_collection_status?: ShiftCollectionStatusTotals
  total_collected: number
  trust_cash_total?: number
}

function parseStatus(raw: unknown): ShiftCollectionStatusTotals | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  return {
    paid: Number(s.paid ?? 0),
    unpaid: Number(s.unpaid ?? 0),
    partial: Number(s.partial ?? 0),
  }
}

function parseTotals(data: unknown): CollectionTotals {
  const raw = (data ?? {}) as Record<string, unknown>
  const methods = (raw.by_payment_method as ShiftPaymentMethodTotal[]) ?? []
  return {
    scope: (raw.scope as 'shift' | 'day') ?? 'day',
    shift_id: raw.shift_id as string | undefined,
    date: raw.date as string | undefined,
    by_payment_method: methods.map((m) => ({
      ...m,
      amount: Number(m.amount ?? 0),
    })),
    by_collection_status: parseStatus(raw.by_collection_status),
    total_collected: Number(raw.total_collected ?? 0),
    trust_cash_total:
      raw.trust_cash_total != null ? Number(raw.trust_cash_total) : undefined,
  }
}

export async function fetchShiftCollectionTotals(
  shiftId: string,
): Promise<CollectionTotals> {
  const { data, error } = await rpc('get_shift_collection_totals', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  return parseTotals(data)
}

export async function fetchDayCollectionTotals(
  date?: string | null,
): Promise<CollectionTotals> {
  const { data, error } = await rpc('get_day_collection_totals', {
    p_date: date ?? null,
  })
  if (error) throw wrap(error)
  return parseTotals(data)
}
