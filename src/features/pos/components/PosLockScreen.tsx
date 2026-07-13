import { useState } from 'react'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { PinPad } from '@/features/pos/components/PinPad'
import { verifyMyPin } from '@/features/pos/api/pos.api'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

/**
 * Lock screen: same authenticated user only.
 * Wrong PIN does not switch accounts. Logout is separate.
 */
export function PosLockScreen() {
  const { staff, unlock, signOut } = useSession()
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const ok = await verifyMyPin(pin)
      if (!ok) {
        setError(t.pos.lock.wrongPin)
        setPin('')
        return
      }
      unlock()
      setPin('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.lock.failed)
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm items-center">
      <Card className="w-full border-0 shadow-none">
        <CardHeader className="px-0 text-center">
          <CardTitle>{t.pos.lock.title}</CardTitle>
          <CardDescription>
            {t.pos.lock.subtitle(staff?.display_name ?? staff?.username ?? '—')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <PinPad
            value={pin}
            onChange={setPin}
            onSubmit={() => void submit()}
            disabled={submitting}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={submitting}
            onClick={() => void signOut()}
          >
            {t.shell.signOut}
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            {t.pos.lock.logoutHint}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
