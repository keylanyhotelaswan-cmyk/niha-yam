import { supabase } from '@/lib/supabase/client'
import type { StaffProfile } from '@/shared/types/identity'
import type { Json } from '@/types/database.generated'

/** Current user's staff/session profile (identity). */
export async function fetchStaffProfile(): Promise<StaffProfile | null> {
  const { data, error } = await supabase.rpc('get_my_staff_profile')
  if (error) throw error
  return (data as StaffProfile | null) ?? null
}

/** Identity/auth audit events. */
export async function logAuthEvent(
  action:
    | 'auth.login'
    | 'auth.login_failed'
    | 'auth.logout'
    | 'auth.password_reset_requested',
  metadata: Json = {},
) {
  await supabase.rpc('log_auth_event', {
    p_action: action,
    p_metadata: metadata,
  })
}
