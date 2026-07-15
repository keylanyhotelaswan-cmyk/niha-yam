import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { cancelOrder } from '@/features/orders/api/orders.api'
import { t } from '@/shared/i18n'

type Props = {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: () => void
}

export function OrderCancelDialog({
  orderId,
  open,
  onOpenChange,
  onCancelled,
}: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const cancelMut = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim()
      if (!trimmed) throw new Error(t.orders.hub.cancelReasonPlaceholder)
      return cancelOrder(orderId, trimmed)
    },
    onSuccess: () => {
      toast.success(t.orders.hub.cancelDone)
      setReason('')
      setError(null)
      onOpenChange(false)
      onCancelled()
    },
    onError: (e: Error) => {
      setError(e.message)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.orders.hub.cancelTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t.orders.hub.cancelHint}</p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="cancel-reason" required>
            {t.orders.hub.cancelReason}
          </Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.orders.hub.cancelReasonPlaceholder}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelMut.isPending}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={cancelMut.isPending}
            onClick={() => cancelMut.mutate()}
          >
            {t.orders.hub.cancelConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
