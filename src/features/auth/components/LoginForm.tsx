import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import {
  loginSchema,
  type LoginFormValues,
} from '@/features/auth/schemas/auth.schemas'
import { usernameToInternalEmail } from '@/features/auth/internal-email'
import { logAuthEvent } from '@/shared/session/session.api'
import { useSession } from '@/shared/session/SessionProvider'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

export function LoginForm() {
  const navigate = useNavigate()
  const { refreshStaff } = useSession()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

  async function onSubmit(values: LoginFormValues) {
    setSubmitting(true)
    setSubmitError(null)
    const email = usernameToInternalEmail(values.username)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: values.password,
      })

      if (error) {
        await logAuthEvent('auth.login_failed', { username: values.username })
        // PROD: generic message (no account enumeration). DEV: real GoTrue error +
        // the derived email actually used, so credential/username mismatches are diagnosable.
        setSubmitError(
          import.meta.env.DEV
            ? `${t.auth.login.invalidCredentials} [DEV: ${error.message} · email=${email}]`
            : t.auth.login.invalidCredentials,
        )
        return
      }

      await refreshStaff()
      await logAuthEvent('auth.login')
      navigate('/gateway', { replace: true })
    } catch {
      setSubmitError(t.auth.login.failed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      {submitError ? (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="username">{t.auth.fields.username}</Label>
        <Input
          id="username"
          autoComplete="username"
          dir="ltr"
          aria-invalid={!!form.formState.errors.username}
          {...form.register('username')}
        />
        {form.formState.errors.username ? (
          <p className="text-destructive text-xs">
            {form.formState.errors.username.message}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t.auth.fields.password}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!form.formState.errors.password}
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p className="text-destructive text-xs">
            {form.formState.errors.password.message}
          </p>
        ) : null}
      </div>
      <Button className="w-full" type="submit" loading={submitting}>
        {t.auth.login.submit}
      </Button>
    </form>
  )
}
