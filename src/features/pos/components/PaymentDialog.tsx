import { useEffect, useMemo, useState } from 'react'
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
import { DiscountFields } from '@/features/pos/components/DiscountFields'
import { MoneyTotalsBreakdown } from '@/features/orders/components/MoneyTotalsBreakdown'
import { finalizeSale } from '@/features/pos/api/pos.api'
import { formatMoney } from '@/features/treasury/utils/format'
import type { CartLine, PosPaymentMethod, TenderInput } from '@/features/pos/types'
import type { PosOrderType } from '@/features/orders/types'
import {
  computeDiscountAmount,
  netAfterDiscount,
  roundMoney,
} from '@/features/pos/utils/saleMoney'
import {
  resolveDiscountPermissions,
  validateDiscountInput,
  type DiscountPermissionConfig,
} from '@/shared/access/discountPermissions'
import { sortPaymentMethods } from '@/features/pos/utils/paymentMethods'
import { useSession } from '@/shared/session/SessionProvider'
import { t } from '@/shared/i18n'

export type PaymentOrderMeta = {
  orderType?: PosOrderType
  customerId?: string | null
  customerPhone?: string | null
  customerName?: string | null
  deliveryAddress?: string | null
  deliveryZone?: string | null
  orderNote?: string | null
  dineInTableRef?: string | null
  deliveryDriverId?: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: CartLine[]
  subtotal: number
  canDiscount: boolean
  discountPermissionsConfig?: DiscountPermissionConfig | null
  paymentMethods: PosPaymentMethod[]
  orderMeta?: PaymentOrderMeta
  onSuccess: (change: number, reference: string) => void
}

type TenderRow = { methodId: string; amount: string }

function computeTotals(
  rows: TenderRow[],
  paymentMethods: PosPaymentMethod[],
  orderTotal: number,
) {
  const parsed = rows.map((r) => ({
    methodId: r.methodId,
    amount: Number(r.amount) || 0,
    method: paymentMethods.find((m) => m.id === r.methodId),
  }))

  let remainingDigitalDue = orderTotal
  let nonCash = 0
  let cashTender = 0
  let tenderSum = 0
  let digitalOverpay = false

  for (const row of parsed) {
    tenderSum += row.amount
    if (row.method?.code === 'cash') {
      cashTender += row.amount
    } else if (row.amount > remainingDigitalDue + 0.001) {
      digitalOverpay = true
    } else {
      nonCash += row.amount
      remainingDigitalDue -= row.amount
    }
  }

  const cashRequired = Math.max(0, orderTotal - nonCash)
  const change = Math.max(0, cashTender - cashRequired)

  return { parsed, tenderSum, nonCash, cashTender, cashRequired, change, digitalOverpay }
}

function mapDiscountError(code: string): string {
  const key = code as keyof typeof t.pos.errors
  return t.pos.errors[key] ?? t.pos.errors.generic
}

export { sortPaymentMethods } from '@/features/pos/utils/paymentMethods'

export function PaymentDialog({
  open,
  onOpenChange,
  lines,
  subtotal,
  canDiscount,
  discountPermissionsConfig,
  paymentMethods,
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

  const methods = useMemo(
    () => sortPaymentMethods(paymentMethods),
    [paymentMethods],
  )
  const [rows, setRows] = useState<TenderRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState('')
  const [discountReason, setDiscountReason] = useState('')

  const defaultMethod = methods.find((m) => m.code === 'cash') ?? methods[0]

  const discountAmount = computeDiscountAmount(
    subtotal,
    discountEnabled && discountPermissions.manual,
    discountType,
    Number(discountValue) || 0,
  )
  const orderTotal = netAfterDiscount(subtotal, discountAmount)

  useEffect(() => {
    if (open && defaultMethod) {
      setRows([
        { methodId: defaultMethod.id, amount: roundMoney(subtotal).toFixed(2) },
      ])
      setError(null)
      setDiscountEnabled(false)
      setDiscountValue('')
      setDiscountReason('')
    }
  }, [open, defaultMethod, subtotal])

  useEffect(() => {
    if (!open) return
    setRows((prev) => {
      if (prev.length === 0) return prev
      const nextAmt = orderTotal.toFixed(2)
      if (prev.length === 1 && prev[0]!.amount !== nextAmt) {
        return [{ ...prev[0]!, amount: nextAmt }]
      }
      return prev
    })
  }, [open, orderTotal])

  const { parsed, tenderSum, cashTender, cashRequired, change, digitalOverpay } =
    useMemo(
      () => computeTotals(rows, methods, orderTotal),
      [rows, methods, orderTotal],
    )

  function addRow() {
    const next = methods.find((m) => !rows.some((r) => r.methodId === m.id))
    if (!next) return
    setRows((prev) => [...prev, { methodId: next.id, amount: '' }])
  }

  function updateRow(index: number, patch: Partial<TenderRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    )
  }

  function validateDiscount(perms: DiscountPermissionConfig): string | null {
    if (!discountEnabled) return null
    const value = Number(discountValue) || 0
    const permErr = validateDiscountInput(perms, discountType, value)
    if (permErr) return mapDiscountError(permErr)
    if (!discountReason.trim()) return t.pos.errors.DISCOUNT_REASON_REQUIRED
    return null
  }

  async function submit() {
    setError(null)
    if (methods.length === 0) {
      setError(t.pos.payment.noPaymentMethods)
      return
    }
    if (digitalOverpay) {
      setError(t.pos.payment.digitalOverpay)
      return
    }
    if (tenderSum < orderTotal) {
      setError(t.pos.payment.underpaid)
      return
    }
    if (cashTender < cashRequired) {
      setError(t.pos.payment.cashShort)
      return
    }
    const discErr = validateDiscount(discountPermissions)
    if (discErr) {
      setError(discErr)
      return
    }

    const tenders: TenderInput[] = parsed
      .filter((r) => r.amount > 0)
      .map((r) => ({ payment_method_id: r.methodId, amount: roundMoney(r.amount) }))

    setSubmitting(true)
    try {
      const result = await finalizeSale({
        items: lines.map((l) => ({
          menu_item_id: l.menuItemId,
          quantity: l.quantity,
          modifier_option_ids: l.modifierOptionIds,
          ...(l.isOpenPrice ? { open_price: l.openPrice } : {}),
          ...(l.note ? { note: l.note } : {}),
        })),
        tenders,
        discount:
          discountEnabled && discountAmount > 0
            ? {
                type: discountType,
                value: Number(discountValue),
                reason: discountReason.trim(),
              }
            : null,
        orderNote: orderMeta?.orderNote ?? null,
        orderType: orderMeta?.orderType ?? 'takeaway',
        customerId: orderMeta?.customerId ?? null,
        customerPhone: orderMeta?.customerPhone ?? null,
        customerName: orderMeta?.customerName ?? null,
        deliveryAddress: orderMeta?.deliveryAddress ?? null,
        deliveryZone: orderMeta?.deliveryZone ?? null,
        dineInTableRef: orderMeta?.dineInTableRef ?? null,
        deliveryDriverId: orderMeta?.deliveryDriverId ?? null,
      })
      toast.success(t.pos.payment.success(result.reference))
      onSuccess(result.change, result.reference)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.pos.payment.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {methods.length === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t.pos.payment.noPaymentMethods}</AlertDescription>
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
            highlightRemaining
          />

          <div className="bg-muted space-y-2 rounded-md p-3 text-sm">
            <div className="flex justify-between">
              <span>{t.pos.payment.amountDue}</span>
              <span className="font-semibold">{formatMoney(orderTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t.pos.payment.tendered}</span>
              <span className="font-semibold">{formatMoney(tenderSum)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t.pos.payment.change}</span>
              <span className="text-primary font-semibold">{formatMoney(change)}</span>
            </div>
          </div>

          {rows.map((row, index) => (
            <div key={`${row.methodId}-${index}`} className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>{t.pos.payment.method}</Label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={row.methodId}
                  onChange={(e) => updateRow(index, { methodId: e.target.value })}
                >
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t.pos.payment.amount}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={row.amount}
                  onChange={(e) => updateRow(index, { amount: e.target.value })}
                />
              </div>
            </div>
          ))}

          {rows.length < methods.length ? (
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              {t.pos.payment.addTender}
            </Button>
          ) : null}

          {digitalOverpay ? (
            <p className="text-destructive text-xs">{t.pos.payment.digitalOverpay}</p>
          ) : null}
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
          <Button
            type="button"
            loading={submitting}
            disabled={methods.length === 0}
            onClick={() => void submit()}
          >
            {t.pos.payment.confirmWithAmount(formatMoney(orderTotal))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
