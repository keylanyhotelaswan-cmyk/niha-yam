import { Menu } from 'lucide-react'
import { AdminUserMenu } from '@/app/layouts/admin/AdminUserMenu'
import { Breadcrumbs } from '@/app/layouts/admin/Breadcrumbs'
import { t } from '@/shared/i18n'

type AdminHeaderProps = {
  onOpenMobileNav: () => void
}

export function AdminHeader({ onOpenMobileNav }: AdminHeaderProps) {
  return (
    <header className="bg-background sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label={t.shell.sidebar.openMenu}
          className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md transition-colors md:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Breadcrumbs />
      </div>
      <AdminUserMenu />
    </header>
  )
}
