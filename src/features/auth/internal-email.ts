/**
 * Username → internal auth email (ADR-0018). Supabase Auth is email-based, but the
 * UI only ever shows usernames. The mapping is deterministic so login needs no lookup.
 *
 * ⚠️ Keep the domain in sync with `supabase/functions/staff-create` (INTERNAL_EMAIL_DOMAIN).
 */
export const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'

export function usernameToInternalEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`
}
