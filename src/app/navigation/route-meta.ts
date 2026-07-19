import { t } from '@/shared/i18n'

export type RouteMetaEntry = {
  path: string
  title: string
  /** Parent path used to build the breadcrumb trail. */
  parent?: string
}

/**
 * Registry of route titles + parent links. Breadcrumbs are derived from this —
 * pages never declare their own breadcrumbs. Add one entry per admin route.
 */
export const routeMeta: RouteMetaEntry[] = [
  { path: '/admin', title: t.shell.nav.dashboard },
  { path: '/admin/menu', title: t.shell.nav.menu, parent: '/admin' },
  { path: '/admin/recipes', title: t.shell.nav.recipes, parent: '/admin' },
  { path: '/admin/inventory', title: t.shell.nav.inventory, parent: '/admin' },
  {
    path: '/admin/purchasing',
    title: t.shell.nav.purchasing,
    parent: '/admin',
  },
  { path: '/admin/treasury', title: t.shell.nav.treasury, parent: '/admin' },
  { path: '/admin/reports', title: t.shell.nav.reports, parent: '/admin' },
  {
    path: '/admin/order-review',
    title: t.shell.nav.orderReview,
    parent: '/admin',
  },
  { path: '/admin/print', title: t.shell.nav.printCenter, parent: '/admin' },
  {
    path: '/admin/ops-feedback',
    title: t.shell.nav.opsFeedback,
    parent: '/admin',
  },
  { path: '/admin/staff', title: t.shell.nav.staff, parent: '/admin' },
  {
    path: '/admin/design-system',
    title: t.shell.nav.designSystem,
    parent: '/admin',
  },
  { path: '/admin/profile', title: t.shell.userMenu.profile, parent: '/admin' },
  {
    path: '/admin/settings',
    title: t.shell.userMenu.settings,
    parent: '/admin',
  },
  {
    path: '/admin/change-password',
    title: t.shell.userMenu.changePassword,
    parent: '/admin',
  },
]

/** Build a breadcrumb trail (root → current) for a pathname from route metadata. */
export function buildBreadcrumbs(pathname: string): RouteMetaEntry[] {
  const byPath = new Map(routeMeta.map((entry) => [entry.path, entry]))

  let current = byPath.get(pathname)
  if (!current) {
    current = routeMeta
      .filter(
        (entry) =>
          pathname === entry.path || pathname.startsWith(`${entry.path}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]
  }
  if (!current) return []

  const trail: RouteMetaEntry[] = []
  const seen = new Set<string>()
  let cursor: RouteMetaEntry | undefined = current
  while (cursor && !seen.has(cursor.path)) {
    trail.unshift(cursor)
    seen.add(cursor.path)
    cursor = cursor.parent ? byPath.get(cursor.parent) : undefined
  }
  return trail
}
