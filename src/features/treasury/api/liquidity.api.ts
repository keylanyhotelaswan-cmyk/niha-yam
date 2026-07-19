import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type { LiquiditySnapshot } from '@/features/treasury/types'

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

export async function fetchLiquiditySnapshot(): Promise<LiquiditySnapshot> {
  const { data, error } = await rpc('liq_get_snapshot')
  if (error) throw wrap(error)
  return data as LiquiditySnapshot
}

export async function upsertLiquiditySettings(input: {
  operating_pct: number
  reserved_pct: number
}): Promise<LiquiditySnapshot> {
  const { data, error } = await rpc('liq_upsert_settings', {
    p_operating_pct: input.operating_pct,
    p_reserved_pct: input.reserved_pct,
  })
  if (error) throw wrap(error)
  return data as LiquiditySnapshot
}

export async function releaseReservedLiquidity(
  amount: number,
  reason: string,
): Promise<LiquiditySnapshot & { released_amount?: number }> {
  const { data, error } = await rpc('liq_release_reserved', {
    p_amount: amount,
    p_reason: reason,
  })
  if (error) throw wrap(error)
  return data as LiquiditySnapshot & { released_amount?: number }
}
