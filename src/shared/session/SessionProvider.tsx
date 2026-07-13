import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { queryClient } from '@/lib/query/client'
import { supabase } from '@/lib/supabase/client'
import { fetchStaffProfile, logAuthEvent } from '@/shared/session/session.api'
import type { StaffProfile } from '@/shared/types/identity'

/** Why the signed-in user lacks staff access (drives the access-denied screen). */
export type StaffStatus = 'active' | 'disabled' | 'missing'

type SessionContextValue = {
  session: Session | null
  user: User | null
  staff: StaffProfile | null
  /** 'active' when staff access is granted; otherwise the reason it is denied. */
  staffStatus: StaffStatus
  isLoading: boolean
  isManager: boolean
  /** POS lock — session stays; UI locked until same user PIN. */
  isLocked: boolean
  refreshStaff: () => Promise<void>
  lock: () => void
  unlock: () => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  // Raw profile (may be inactive). Downstream `staff` exposes active-only.
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)

  const refreshStaff = useCallback(async () => {
    const next = await fetchStaffProfile()
    setProfile(next)
  }, [])

  const lock = useCallback(() => {
    setIsLocked(true)
  }, [])

  const unlock = useCallback(() => {
    setIsLocked(false)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logAuthEvent('auth.logout')
    } catch {
      // ignore audit failures on logout
    }
    setIsLocked(false)
    setProfile(null)
    setSession(null)
    queryClient.clear()
    await supabase.auth.signOut()
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(data.session)
      if (data.session) {
        try {
          const next = await fetchStaffProfile()
          if (mounted) setProfile(next)
        } catch {
          if (mounted) setProfile(null)
        }
      }
      if (mounted) setIsLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setProfile(null)
        setIsLocked(false)
        return
      }
      // Clear stale profile before fetch so previous user never flashes.
      setProfile(null)
      void fetchStaffProfile()
        .then((next) => mounted && setProfile(next))
        .catch(() => mounted && setProfile(null))
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Active-only profile — every downstream gate (guards, permissions) treats a
  // deactivated account as no access. staffStatus carries the reason for the UI.
  const staff = useMemo(() => (profile?.is_active ? profile : null), [profile])

  const staffStatus: StaffStatus = useMemo(() => {
    if (!profile) return 'missing'
    return profile.is_active ? 'active' : 'disabled'
  }, [profile])

  const isManager = useMemo(
    () =>
      staff?.branches.some((b) => b.role === 'owner' || b.role === 'manager') ??
      false,
    [staff],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      staff,
      staffStatus,
      isLoading,
      isManager,
      isLocked,
      refreshStaff,
      lock,
      unlock,
      signOut,
    }),
    [
      session,
      staff,
      staffStatus,
      isLoading,
      isManager,
      isLocked,
      refreshStaff,
      lock,
      unlock,
      signOut,
    ],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within SessionProvider')
  }
  return ctx
}
