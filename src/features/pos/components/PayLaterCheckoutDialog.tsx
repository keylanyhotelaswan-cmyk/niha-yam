import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { DiscountFields } from '@/features/pos/components/DiscountFields'
import { MoneyTotalsBreakdown } from '@/features/orders/components/MoneyTotalsBreakdown'
import { createUnpaidOrder } from '@/features/orders/api/orders.api'
import { formatMoney } from '@/features/treasury/utils/format'
import type { CartLine } from '@/features/pos/types'
import type { PaymentOrderMeta } from '@/features/pos/components/PaymentDialog'
import {
  computeDiscountAmount,
  netAfterDiscount,
} from '@/features/pos/utils/saleMoney'
import {
  resolveDiscountPermissions,
  validateDiscountInput,
} from '@/shared/access/discountPermissions'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: CartLine[]
  subtotal: number
  canDiscount: boolean
  discountPermissionsConfig?: import('@/shared/access/discountPermissions').DiscountPermissionConfig | null
  orderMeta: PaymentOrderMeta
  onSuccess: (reference: string) => void
}

export function PayLaterCheckoutDialog({
  open,
  onOpenChange,
  lines,
  subtotal,
  canDiscount,
  discountPermissionsConfig,
  orderMeta,
  onSuccess,
}: Props) {
  const { staff } = useSession()
  const roles = staff?.branches.map((b) => b.role) ?? []
  const discountPermissions = useMemo(
    () =>
      resolveDiscountPermissions(canDiscount, roles, discountPermissionsConfig),
    [canDiscount, roles, discountPermissionsConfig],
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState('')
  const [discountReason, setDiscountReason] = useState('')

  const discountAmount = computeDiscountAmount(
    subtotal,
    discountEnabled && discountPermissions.manual,
    discountType,
    Number(discountValue) || 0,
  )
  const orderTotal = netAfterDiscount(subtotal, discountAmount)

  useEffect(() => {
    if (open) {
      setError(null)
      setDiscountEnabled(false)
      setDiscountValue('')
      setDiscountReason('')
    }
  }, [open])

  async function submit() {
    setError(null)
    if (discountEnabled) {
      const value = Number(discountValue) || 0
      const permErr = validateDiscountInput(discountPermissions, discountType, value)
      if (permErr) {
        const key = permErr as keyof typeof t.pos.errors
        setError(t.pos.errors[key] ?? t.pos.errors.generic)
        return
      }
      if (!discountReason.trim()) {
        setError(t.pos.errors.DISCOUNT_REASON_REQUIRED)
        return
      }
    }

    setSubmitting(true)
    try {
      const result = await createUnpaidOrder({
        items: lines.map((line) => ({
          menu_item_id: line.menuItemId,
          quantity: line.quantity,
          modifier_option_ids: line.modifierOptionIds,
          open_price: line.openPrice,
          note: line.note,
        })),
        orderType: orderMeta.orderType ?? 'takeaway',
        customerId: orderMeta.customerId ?? null,
        customerPhone: orderMeta.customerPhone ?? null,
        customerName: orderMeta.customerName ?? null,
        deliveryAddress: orderMeta.deliveryAddress ?? null,
        deliveryZone: orderMeta.deliveryZone ?? null,
        orderNote: orderMeta.orderNote ?? null,
        dineInTableRef: orderMeta.dineInTableRef ?? null,
        deliveryDriverId: orderMeta.deliveryDriverId ?? null,
        discount:
          discountEnabled && discountAmount > 0
            ? {
                type: discountType,
                value: Number(discountValue),
                reason: discountReason.trim(),
              }
            : null,
      })
      onSuccess(String(result.reference))
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.orders.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.pos.payLater.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DiscountFields
            permissions={discountPermissions}
            enabled={discountEnabled}
            onEnabledChange={setDiscountEnabled}
            type={discountType}
            onTypeChange={setDiscountType}
            value={discountValue}
            onValueChange={setDiscountValue}
            reason={discountReason}
            onReasonChange={setDiscountReason}
          />

          <MoneyTotalsBreakdown
            subtotal={subtotal}
            discountAmount={discountAmount}
            discountType={discountEnabled ? discountType : null}
            discountValue={discountEnabled ? Number(discountValue) || null : null}
            total={orderTotal}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="button" loading={submitting} onClick={() => void submit()}>
            {t.pos.payLater.confirm} · {formatMoney(orderTotal)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
