import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { LoginForm } from '@/features/auth/components/LoginForm'
import { t } from '@/shared/i18n'

export function LoginPage() {
  return (
    <Card className="border-0 shadow-none">
      <CardHeader className="px-0 pt-0">
        <CardTitle>{t.auth.login.title}</CardTitle>
        <CardDescription>{t.auth.login.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <LoginForm />
      </CardContent>
    </Card>
  )
}
