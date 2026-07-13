import { ChevronLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { buildBreadcrumbs } from '@/app/navigation/route-meta'
import { t } from '@/shared/i18n'

export function Breadcrumbs() {
  const { pathname } = useLocation()
  const trail = buildBreadcrumbs(pathname)
  if (trail.length === 0) return null

  return (
    <nav aria-label={t.shell.breadcrumbs.label}>
      <ol className="flex items-center gap-1.5 text-sm">
        {trail.map((entry, index) => {
          const isLast = index === trail.length - 1
          return (
            <li key={entry.path} className="flex items-center gap-1.5">
              {index > 0 ? (
                <ChevronLeft
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
              ) : null}
              {isLast ? (
                <span
                  className="text-foreground font-medium"
                  aria-current="page"
                >
                  {entry.title}
                </span>
              ) : (
                <Link
                  to={entry.path}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {entry.title}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
