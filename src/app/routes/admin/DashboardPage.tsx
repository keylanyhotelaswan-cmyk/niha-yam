import { Link } from 'react-router-dom'
import { OpsMessagesPanel } from '@/features/ops-messages/components/OpsMessagesPanel'
import { PendingHandoverBanner } from '@/features/treasury/components/PendingHandoverBanner'
import { usePermissions } from '@/shared/access/permissions'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { t } from '@/shared/i18n'

/** Thin pointer into Reports — no independent KPI math (M8A Q-R1 / A1). */
export function DashboardPage() {
  const { can } = usePermissions()
  return (
    <div className="space-y-6">
      <PageHeader
        title={t.shell.pages.dashboard.title}
        description={t.shell.pages.dashboard.body}
      />
      {can('treasury.manage') ? <PendingHandoverBanner /> : null}
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{t.reports.dashboard.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t.reports.dashboard.body}
          </p>
          <Button asChild>
            <Link to="/admin/reports">{t.reports.dashboard.open}</Link>
          </Button>
        </CardContent>
      </Card>
      {can('treasury.manage') ? <OpsMessagesPanel /> : null}
    </div>
  )
}
