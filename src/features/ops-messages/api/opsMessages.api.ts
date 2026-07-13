import { supabase } from '@/lib/supabase/client'

export type OpsMessageRow = {
  id: string
  reference: string
  body: string
  target_role: string | null
  target_station: string | null
  created_at: string
  acknowledged_at: string | null
  print_job_id: string | null
  created_by_name: string | null
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

function wrap(error: { message: string }): Error {
  return new Error(error.message)
}

export async function sendOpsMessage(input: {
  body: string
  targetRole?: string
  targetStation?: string | null
  print?: boolean
}): Promise<string> {
  const { data, error } = await rpc('send_ops_message', {
    p_body: input.body,
    p_target_role: input.targetRole ?? 'cashier',
    p_target_station: input.targetStation ?? null,
    p_print: input.print ?? false,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function listOpsMessages(limit = 50): Promise<OpsMessageRow[]> {
  const { data, error } = await rpc('list_ops_messages', { p_limit: limit })
  if (error) throw wrap(error)
  return (data as OpsMessageRow[]) ?? []
}

export async function acknowledgeOpsMessage(id: string): Promise<void> {
  const { error } = await rpc('acknowledge_ops_message', { p_id: id })
  if (error) throw wrap(error)
}
