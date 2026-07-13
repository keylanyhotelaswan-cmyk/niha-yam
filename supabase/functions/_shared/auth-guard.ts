import {
  createClient,
  type SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { HttpError } from './http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type GuardResult = {
  actorUserId: string
  /** Service-role client — used ONLY after the manager check passes. */
  service: SupabaseClient
}

/**
 * Verifies the caller is an authenticated owner/manager (via their JWT and the
 * `is_owner_or_manager()` RPC), then returns a service-role client. Enforces the
 * ADR-0019 rule: authorize first, then use the service role.
 */
export async function requireManager(req: Request): Promise<GuardResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new HttpError(401, 'NO_AUTH')

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData.user) throw new HttpError(401, 'NO_AUTH')

  const { data: isManager, error: rpcErr } = await caller.rpc(
    'is_owner_or_manager',
  )
  if (rpcErr) throw new HttpError(500, 'AUTH_CHECK_FAILED')
  if (!isManager) throw new HttpError(403, 'PERMISSION_DENIED')

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { actorUserId: userData.user.id, service }
}
