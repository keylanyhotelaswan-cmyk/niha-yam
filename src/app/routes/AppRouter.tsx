import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
import { AdminLayout } from '@/app/layouts/AdminLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { PosLayout } from '@/app/layouts/PosLayout'
import {
  GuestOnly,
  RequireAuth,
  RequireManager,
} from '@/features/auth/guards/AuthGuards'
import { t } from '@/shared/i18n'

const HealthPage = lazy(() =>
  import('@/app/routes/HealthPage').then((m) => ({ default: m.HealthPage })),
)
const LoginPage = lazy(() =>
  import('@/features/auth/pages/LoginPage').then((m) => ({
    default: m.LoginPage,
  })),
)
const PosRoute = lazy(() =>
  import('@/features/pos/guards/PosRoute').then((m) => ({
    default: m.PosRoute,
  })),
)
const StaffListPage = lazy(() =>
  import('@/features/staff/pages/StaffListPage').then((m) => ({
    default: m.StaffListPage,
  })),
)
const MenuPage = lazy(() =>
  import('@/features/menu/pages/MenuPage').then((m) => ({
    default: m.MenuPage,
  })),
)
const TreasuryPage = lazy(() =>
  import('@/features/treasury/pages/TreasuryPage').then((m) => ({
    default: m.TreasuryPage,
  })),
)
const ReportsPage = lazy(() =>
  import('@/features/reports/pages/ReportsPage').then((m) => ({
    default: m.ReportsPage,
  })),
)
const RecipesPage = lazy(() =>
  import('@/features/recipes/pages/RecipesPage').then((m) => ({
    default: m.RecipesPage,
  })),
)
const InventoryPage = lazy(() =>
  import('@/features/inventory/pages/InventoryPage').then((m) => ({
    default: m.InventoryPage,
  })),
)
const DashboardPage = lazy(() =>
  import('@/app/routes/admin/DashboardPage').then((m) => ({
    default: m.DashboardPage,
  })),
)
const DesignSystemPage = lazy(() =>
  import('@/app/routes/admin/DesignSystemPage').then((m) => ({
    default: m.DesignSystemPage,
  })),
)
const ProfilePage = lazy(() =>
  import('@/app/routes/admin/ProfilePage').then((m) => ({
    default: m.ProfilePage,
  })),
)
const SettingsPage = lazy(() =>
  import('@/app/routes/admin/SettingsPage').then((m) => ({
    default: m.SettingsPage,
  })),
)
const ChangePasswordPage = lazy(() =>
  import('@/app/routes/admin/ChangePasswordPage').then((m) => ({
    default: m.ChangePasswordPage,
  })),
)
const PostLoginGatewayPage = lazy(() =>
  import('@/features/auth/pages/PostLoginGatewayPage').then((m) => ({
    default: m.PostLoginGatewayPage,
  })),
)
const CallCenterRoute = lazy(() =>
  import('@/features/call-center/guards/CallCenterRoute').then((m) => ({
    default: m.CallCenterRoute,
  })),
)
const OrderReviewQueuePage = lazy(() =>
  import('@/features/orders/pages/OrderReviewQueuePage').then((m) => ({
    default: m.OrderReviewQueuePage,
  })),
)
const PrintCenterPage = lazy(() =>
  import('@/features/print/pages/PrintCenterPage').then((m) => ({
    default: m.PrintCenterPage,
  })),
)
const OpsFeedbackAdminPage = lazy(() =>
  import('@/features/ops-feedback/components/OpsFeedbackAdminPage').then(
    (m) => ({ default: m.OpsFeedbackAdminPage }),
  ),
)
/** Temporary POS UX wireframe — mock only; remove after approval. */
const PosWireframePage = lazy(() =>
  import('@/app/routes/ui/PosWireframePage').then((m) => ({
    default: m.PosWireframePage,
  })),
)

function RouteFallback() {
  return (
    <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
      {t.common.loading}
    </div>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/health" replace />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/ui/pos-wireframe" element={<PosWireframePage />} />

          <Route element={<GuestOnly />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
          </Route>

          <Route element={<PosLayout />}>
            <Route path="/pos/*" element={<PosRoute />} />
            <Route path="/call-center" element={<CallCenterRoute />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/gateway" element={<PostLoginGatewayPage />} />
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<DashboardPage />} />
              <Route path="/admin/profile" element={<ProfilePage />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
              <Route
                path="/admin/change-password"
                element={<ChangePasswordPage />}
              />
              <Route element={<RequireManager />}>
                <Route path="/admin/staff" element={<StaffListPage />} />
                <Route path="/admin/menu" element={<MenuPage />} />
                <Route path="/admin/recipes" element={<RecipesPage />} />
                <Route path="/admin/inventory" element={<InventoryPage />} />
                <Route path="/admin/treasury" element={<TreasuryPage />} />
                <Route path="/admin/reports" element={<ReportsPage />} />
                <Route
                  path="/admin/order-review"
                  element={<OrderReviewQueuePage />}
                />
                <Route path="/admin/print" element={<PrintCenterPage />} />
                <Route
                  path="/admin/ops-feedback"
                  element={<OpsFeedbackAdminPage />}
                />
                <Route
                  path="/admin/design-system"
                  element={<DesignSystemPage />}
                />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/health" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
