import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AdminHeader } from '@/app/layouts/admin/AdminHeader'
import { AdminSidebar } from '@/app/layouts/admin/AdminSidebar'
import { useOpsRealtime } from '@/shared/realtime/useOpsRealtime'

const COLLAPSE_KEY = 'niha.sidebar.collapsed'

export function AdminLayout() {
  useOpsRealtime(true)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="bg-muted/30 flex min-h-screen">
      <div className="hidden md:block">
        <AdminSidebar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
        />
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="bg-foreground/40 absolute inset-0"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 end-0 h-full">
            <AdminSidebar
              collapsed={false}
              onToggleCollapsed={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
