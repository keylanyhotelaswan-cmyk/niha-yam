import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AccessDeniedScreen } from '@/features/auth/components/AccessDeniedScreen'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

export function RequireAuth() {
  const { session, staff, staffStatus, isLoading } = useSession()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
        {t.shell.session.loading}
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!staff) {
    return (
      <AccessDeniedScreen
        reason={staffStatus === 'disabled' ? 'disabled' : 'missing'}
      />
    )
  }

  return <Outlet />
}

export function RequireManager() {
  const { isManager } = useSession()
  if (!isManager) {
    return <Navigate to="/admin" replace />
  }
  return <Outlet />
}

/** Print Center only — owner/manager or staff.can_print_manage. */
export function RequirePrintManage() {
  const { can } = usePermissions()
  if (!can('print.manage')) {
    return <Navigate to="/admin" replace />
  }
  return <Outlet />
}

export function GuestOnly() {
  const { session, isLoading } = useSession()
  if (isLoading) return null
  if (session) return <Navigate to="/gateway" replace />
  return <Outlet />
}
