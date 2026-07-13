import type { ReactNode } from 'react'
import { Button, type ButtonProps } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import { t } from '@/shared/i18n'

export type ConfirmDialogProps = {
  title?: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Visual variant of the confirm button (e.g. 'destructive'). */
  confirmVariant?: ButtonProps['variant']
  /** Feature-owned confirm handler. This pattern holds no business logic. */
  onConfirm: () => void
  /** Shows a loading spinner + disables the confirm button. */
  loading?: boolean
  /** Uncontrolled usage: element that opens the dialog. */
  trigger?: ReactNode
  /** Controlled usage. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

/**
 * General-purpose confirmation dialog (ADR-0008): stateless, presentation-only.
 * It does not know what it confirms — the feature passes copy + `onConfirm`.
 *
 * NOT for financial confirmations (collection, reversal, expense, treasury): those
 * must go through F1 Financial Approval Foundation (ADR-0005), never this component.
 */
export function ConfirmDialog({
  title = t.patterns.confirm.title,
  description = t.patterns.confirm.description,
  confirmLabel = t.common.confirm,
  cancelLabel = t.common.cancel,
  confirmVariant = 'default',
  onConfirm,
  loading = false,
  trigger,
  open,
  onOpenChange,
  defaultOpen,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={confirmVariant}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
