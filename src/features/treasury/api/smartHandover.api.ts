import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type { SmartShiftSheet } from '@/features/treasury/types'

type ErrorCode = keyof typeof t.treasury.errors

function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.treasury.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.treasury.errors[code] : t.treasury.errors.generic
}

function wrap(error: { message: string }): Error {
  return new Error(rpcErrorMessage(error.message))
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

export async function fetchSmartShiftSheet(
  shiftId: string,
): Promise<SmartShiftSheet> {
  const { data, error } = await rpc('get_smart_shift_sheet', {
    p_shift_id: shiftId,
  })
  if (error) throw wrap(error)
  return data as SmartShiftSheet
}

export async function reviewShiftHandover(
  id: string,
  decision: 'approved' | 'rejected',
  notes?: string | null,
): Promise<{
  handover_id: string
  review_status: string
  money_status: string
}> {
  const { data, error } = await rpc('review_shift_handover', {
    p_id: id,
    p_decision: decision,
    p_notes: notes ?? null,
  })
  if (error) throw wrap(error)
  return data as {
    handover_id: string
    review_status: string
    money_status: string
  }
}
