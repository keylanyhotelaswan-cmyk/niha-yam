import {
  Activity,
  ClipboardList,
  FileBarChart2,
  KeyRound,
  LayoutDashboard,
  Palette,
  Printer,
  Settings,
  Store,
  User,
  Users,
  UtensilsCrossed,
  Wallet,
  ChefHat,
  Package,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/shared/access/permissions'
import { t } from '@/shared/i18n'

export type NavItem = {
  id: string
  to: string
  label: string
  icon: LucideIcon
  permission: Permission
  /** Exact-match active state (used for the index route). */
  end?: boolean
}

/**
 * Single source of truth for primary navigation. The sidebar renders from this
 * list and filters items by the current user's permissions.
 */
export const adminNav: NavItem[] = [
  {
    id: 'dashboard',
    to: '/admin',
    end: true,
    label: t.shell.nav.dashboard,
    icon: LayoutDashboard,
    permission: 'dashboard.view',
  },
  {
    id: 'menu',
    to: '/admin/menu',
    label: t.shell.nav.menu,
    icon: UtensilsCrossed,
    permission: 'menu.manage',
  },
  {
    id: 'recipes',
    to: '/admin/recipes',
    label: t.shell.nav.recipes,
    icon: ChefHat,
    permission: 'recipes.manage',
  },
  {
    id: 'inventory',
    to: '/admin/inventory',
    label: t.shell.nav.inventory,
    icon: Package,
    permission: 'inventory.manage',
  },
  {
    id: 'treasury',
    to: '/admin/treasury',
    label: t.shell.nav.treasury,
    icon: Wallet,
    permission: 'treasury.manage',
  },
  {
    id: 'reports',
    to: '/admin/reports',
    label: t.shell.nav.reports,
    icon: FileBarChart2,
    permission: 'reports.view',
  },
  {
    id: 'order-review',
    to: '/admin/order-review',
    label: t.shell.nav.orderReview,
    icon: ClipboardList,
    permission: 'orders.review',
  },
  {
    id: 'print-center',
    to: '/admin/print',
    label: t.shell.nav.printCenter,
    icon: Printer,
    permission: 'print.manage',
  },
  {
    id: 'ops-feedback',
    to: '/admin/ops-feedback',
    label: t.shell.nav.opsFeedback,
    icon: MessageSquareText,
    permission: 'treasury.manage',
  },
  {
    id: 'staff',
    to: '/admin/staff',
    label: t.shell.nav.staff,
    icon: Users,
    permission: 'staff.manage',
  },
  {
    id: 'design-system',
    to: '/admin/design-system',
    label: t.shell.nav.designSystem,
    icon: Palette,
    permission: 'design_system.view',
  },
  {
    id: 'pos',
    to: '/pos',
    label: t.shell.nav.pos,
    icon: Store,
    permission: 'pos.access',
  },
  {
    id: 'health',
    to: '/health',
    label: t.shell.nav.health,
    icon: Activity,
    permission: 'diagnostics.view',
  },
]

export type UserMenuItem = {
  id: string
  to: string
  label: string
  icon: LucideIcon
}

/** Extensible user-menu model (personal pages, available to any signed-in staff). */
export const userMenuItems: UserMenuItem[] = [
  {
    id: 'profile',
    to: '/admin/profile',
    label: t.shell.userMenu.profile,
    icon: User,
  },
  {
    id: 'settings',
    to: '/admin/settings',
    label: t.shell.userMenu.settings,
    icon: Settings,
  },
  {
    id: 'change-password',
    to: '/admin/change-password',
    label: t.shell.userMenu.changePassword,
    icon: KeyRound,
  },
]
