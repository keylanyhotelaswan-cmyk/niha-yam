import { toast } from 'sonner'
import { useSetStaffStatus } from '@/features/staff/hooks/useSetStaffStatus'
import { ConfirmDialog } from '@/shared/components/patterns/ConfirmDialog'
import { t } from '@/shared/i18n'

type StaffStatusDialogProps = {
  staffId: string
  staffName: string
  /** The status to switch TO. */
  activate: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * General (non-financial) confirmation for activating/deactivating staff.
 * Financial confirmations must go through F1 (ADR-0005), never ConfirmDialog.
 */
export function StaffStatusDialog({
  staffId,
  staffName,
  activate,
  open,
  onOpenChange,
}: StaffStatusDialogProps) {
  const statusMutation = useSetStaffStatus()
  const copy = activate ? t.staff.activate : t.staff.deactivate

  function onConfirm() {
    statusMutation.mutate(
      {
        staffId,
        active: activate,
        reason: activate ? undefined : t.staff.deactivate.reason,
      },
      {
        onSuccess: () => {
          toast.success(copy.success)
          onOpenChange(false)
        },
        onError: (error: Error) => toast.error(error.message),
      },
    )
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description(staffName)}
      confirmLabel={copy.confirm}
      confirmVariant={activate ? 'default' : 'destructive'}
      loading={statusMutation.isPending}
      onConfirm={onConfirm}
    />
  )
}
