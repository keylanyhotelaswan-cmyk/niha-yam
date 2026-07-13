import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

/** After password login: choose Admin, POS, or Call Center when available. */
export function PostLoginGatewayPage() {
  const navigate = useNavigate()
  const { staff } = useSession()
  const { can } = usePermissions()

  const canPos = can('pos.access')
  const canAdmin = can('dashboard.view')
  const canCallCenter = can('call_center.access') && !can('treasury.manage')
  const choiceCount =
    Number(canPos) + Number(canAdmin) + Number(canCallCenter ? 1 : 0)

  useEffect(() => {
    if (choiceCount !== 1) return
    if (canCallCenter) navigate('/call-center', { replace: true })
    else if (canPos) navigate('/pos', { replace: true })
    else if (canAdmin) navigate('/admin', { replace: true })
  }, [choiceCount, canPos, canAdmin, canCallCenter, navigate])

  if (choiceCount < 2) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
        {t.common.loading}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <Card className="w-full border-0 shadow-none">
        <CardHeader className="px-0 text-center">
          <CardTitle>{t.auth.gateway.title}</CardTitle>
          <CardDescription>
            {staff?.display_name
              ? t.auth.gateway.welcome(staff.display_name)
              : t.auth.gateway.subtitle}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-0">
          {canAdmin ? (
            <Button
              className="h-12 w-full"
              type="button"
              onClick={() => navigate('/admin', { replace: true })}
            >
              {t.auth.gateway.admin}
            </Button>
          ) : null}
          {canPos ? (
            <Button
              className="h-12 w-full"
              type="button"
              variant="outline"
              onClick={() => navigate('/pos', { replace: true })}
            >
              {t.auth.gateway.pos}
            </Button>
          ) : null}
          {canCallCenter ? (
            <Button
              className="h-12 w-full"
              type="button"
              variant="outline"
              onClick={() => navigate('/call-center', { replace: true })}
            >
              {t.auth.gateway.callCenter}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
