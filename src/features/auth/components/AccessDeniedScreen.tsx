import { useEffect, useState } from 'react'
import { useSession } from '@/shared/session/SessionProvider'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/i18n'

const COUNTDOWN_SECONDS = 5

/**
 * Shown when a signed-in user has no staff access (deactivated or no profile).
 * Explains the real reason, then auto-signs-out and returns to /login so the
 * user is never stuck. `signOut()` clears the session → RequireAuth redirects.
 */
export function AccessDeniedScreen({
  reason,
}: {
  reason: 'disabled' | 'missing'
}) {
  const { signOut } = useSession()
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS)

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((current) => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (seconds === 0) void signOut()
  }, [seconds, signOut])

  const title =
    reason === 'disabled'
      ? t.shell.session.disabledTitle
      : t.shell.session.noStaffTitle
  const body =
    reason === 'disabled'
      ? t.shell.session.disabledBody
      : t.shell.session.noStaffBody

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{body}</p>
      <p className="text-muted-foreground text-sm">
        {t.shell.session.redirectCountdown(seconds)}
      </p>
      <Button variant="outline" onClick={() => void signOut()}>
        {t.shell.session.signOut}
      </Button>
    </div>
  )
}
