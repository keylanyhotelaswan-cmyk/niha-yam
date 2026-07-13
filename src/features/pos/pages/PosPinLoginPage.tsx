import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { PinPad } from '@/features/pos/components/PinPad'
import { pinLogin } from '@/features/pos/api/pos.api'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

export function PosPinLoginPage() {
  const { refreshStaff } = useSession()
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await pinLogin(pin)
      await refreshStaff()
      setPin('')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.pin.failed)
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm items-center">
      <Card className="w-full border-0 shadow-none">
        <CardHeader className="px-0 text-center">
          <CardTitle>{t.pos.pin.title}</CardTitle>
          <CardDescription>{t.pos.pin.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <PinPad
            value={pin}
            onChange={setPin}
            onSubmit={() => void submit()}
            disabled={submitting}
          />
        </CardContent>
      </Card>
    </div>
  )
}
