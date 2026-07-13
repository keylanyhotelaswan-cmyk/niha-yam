import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { adminNav } from '@/app/navigation/admin-nav'
import { usePermissions } from '@/shared/access/permissions'
import { t } from '@/shared/i18n'
import { cn } from '@/shared/utils/cn'

type AdminSidebarProps = {
  collapsed: boolean
  onToggleCollapsed: () => void
  onNavigate?: () => void
}

export function AdminSidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: AdminSidebarProps) {
  const { can } = usePermissions()
  const items = adminNav.filter((item) => can(item.permission))

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-e',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        {!collapsed ? (
          <span className="text-sidebar-foreground text-base font-semibold">
            {t.shell.brand}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={
            collapsed ? t.shell.sidebar.expand : t.shell.sidebar.collapse
          }
          className="text-sidebar-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground inline-flex size-9 items-center justify-center rounded-md transition-colors"
        >
          {collapsed ? (
            <PanelRightOpen className="size-5" aria-hidden />
          ) : (
            <PanelRightClose className="size-5" aria-hidden />
          )}
        </button>
      </div>

      <nav
        aria-label={t.shell.sidebar.primary}
        className="flex-1 space-y-1 overflow-y-auto px-2 py-2"
      >
        {items.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'text-sidebar-muted-foreground hover:bg-sidebar-accent/10 hover:text-sidebar-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive &&
                    'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {!collapsed ? (
                <span className="truncate">{item.label}</span>
              ) : null}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
