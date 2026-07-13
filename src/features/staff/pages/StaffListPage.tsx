import { Users } from 'lucide-react'
import { CreateStaffDialog } from '@/features/staff/components/dialogs/CreateStaffDialog'
import { StaffTable } from '@/features/staff/components/StaffTable'
import { useStaffList } from '@/features/staff/hooks/useStaffList'
import { usePermissions } from '@/shared/access/permissions'
import { useSession } from '@/shared/session/SessionProvider'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/patterns/EmptyState'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { t } from '@/shared/i18n'

export function StaffListPage() {
  const { staff: currentStaff } = useSession()
  const { can } = usePermissions()
  const canManage = can('staff.manage')

  const staffQuery = useStaffList()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.staff.title}
        description={t.staff.subtitle(currentStaff?.display_name ?? '')}
        actions={canManage ? <CreateStaffDialog /> : null}
      />

      <Card>
        <CardContent className="p-0">
          {staffQuery.isLoading ? (
            <LoadingState />
          ) : staffQuery.isError ? (
            <ErrorState
              description={t.staff.team.loadFailed}
              onRetry={() => void staffQuery.refetch()}
            />
          ) : (staffQuery.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Users}
              title={t.staff.team.empty}
              description={t.staff.team.emptyDescription}
            />
          ) : (
            <StaffTable
              items={staffQuery.data ?? []}
              currentStaffId={currentStaff?.id}
              canManage={canManage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
