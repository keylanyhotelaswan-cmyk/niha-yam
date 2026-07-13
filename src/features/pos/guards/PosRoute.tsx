import { AccessDeniedScreen } from '@/features/auth/components/AccessDeniedScreen'
import { PosLockScreen } from '@/features/pos/components/PosLockScreen'
import { PosPage } from '@/features/pos/pages/PosPage'
import { PosWorkspace } from '@/features/pos/components/PosWorkspace'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'
import { Navigate, Route, Routes } from 'react-router-dom'

/**
 * POS entry:
 * - No session → Login (username then credentials) — never anonymous PIN auto-pick.
 * - Locked → Lock screen (same user PIN only).
 * - Active session → POS.
 */
function PosShell() {
  const { session, staff, staffStatus, isLoading, isLocked } = useSession()
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

  if (isLocked) {
    return <PosLockScreen />
  }

  if (!staff) {
    return (
      <AccessDeniedScreen
        reason={staffStatus === 'disabled' ? 'disabled' : 'missing'}
      />
    )
  }

  if (!can('pos.access')) {
    return <AccessDeniedScreen reason="missing" />
  }

  return (
    <PosWorkspace>
      <Routes>
        <Route index element={<PosPage />} />
        <Route path="orders" element={<Navigate to="/pos" replace />} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </PosWorkspace>
  )
}

export function PosRoute() {
  return <PosShell />
}
