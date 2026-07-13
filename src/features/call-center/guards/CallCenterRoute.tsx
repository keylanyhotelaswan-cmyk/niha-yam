import { Navigate } from 'react-router-dom'
import { AccessDeniedScreen } from '@/features/auth/components/AccessDeniedScreen'
import { CallCenterPage } from '@/features/call-center/pages/CallCenterPage'
import { PosWorkspace } from '@/features/pos/components/PosWorkspace'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

/** Session + call_center.access — no treasury chrome. */
export function CallCenterRoute() {
  const { session, staff, staffStatus, isLoading } = useSession()
  const { can } = usePermissions()

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
        {t.shell.session.loading}
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!staff) {
    return (
      <AccessDeniedScreen
        reason={staffStatus === 'disabled' ? 'disabled' : 'missing'}
      />
    )
  }

  if (!can('call_center.access')) {
    return <AccessDeniedScreen reason="missing" />
  }

  return (
    <PosWorkspace>
      <CallCenterPage />
    </PosWorkspace>
  )
}
