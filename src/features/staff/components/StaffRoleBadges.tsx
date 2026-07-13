import { Badge } from '@/shared/components/ui/badge'
import { t } from '@/shared/i18n'
import type { StaffBranchAssignment } from '@/features/staff/types'

/** Renders staff role label(s). Single branch (ADR-0017) → typically one badge. */
export function StaffRoleBadges({
  branches,
}: {
  branches: StaffBranchAssignment[]
}) {
  if (branches.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {branches.map((branch) => (
        <Badge key={`${branch.branch_id}-${branch.role}`} variant="secondary">
          {t.staff.roles[branch.role]}
        </Badge>
      ))}
    </div>
  )
}
