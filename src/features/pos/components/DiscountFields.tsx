import { Input } from '@/shared/components/ui/input'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import type { DiscountPermissionConfig } from '@/shared/access/discountPermissions'
import { t } from '@/shared/i18n'

type Props = {
  permissions: DiscountPermissionConfig
  enabled: boolean
  onEnabledChange: (next: boolean) => void
  type: 'amount' | 'percent'
  onTypeChange: (next: 'amount' | 'percent') => void
  value: string
  onValueChange: (next: string) => void
  reason: string
  onReasonChange: (next: string) => void
  /** When parent knows discount is locked (e.g. edit after approve). */
  locked?: boolean
}

export function DiscountFields({
  permissions,
  enabled,
  onEnabledChange,
  type,
  onTypeChange,
  value,
  onValueChange,
  reason,
  onReasonChange,
  locked,
}: Props) {
  if (!permissions.manual) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
        {t.pos.discount.noPermission}
      </p>
    )
  }

  if (locked) {
    return (
      <p className="text-muted-foreground rounded-md border bg-[#f8fafc] p-3 text-xs">
        {t.pos.discount.lockedOnEdit}
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        {t.pos.payment.discount}
      </label>
      {enabled ? (
        <div className="grid gap-2">
          <select
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={type}
            onChange={(e) => onTypeChange(e.target.value as 'amount' | 'percent')}
            disabled={!permissions.typeAmount || !permissions.typePercent}
          >
            {permissions.typeAmount ? (
              <option value="amount">{t.pos.payment.discountTypes.amount}</option>
            ) : null}
            {permissions.typePercent ? (
              <option value="percent">{t.pos.payment.discountTypes.percent}</option>
            ) : null}
          </select>
          <Input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            placeholder={
              type === 'percent'
                ? t.pos.payment.discountPercent
                : t.pos.payment.discountAmount
            }
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
          />
          {type === 'amount' && permissions.maxAmount != null ? (
            <p className="text-muted-foreground text-xs">
              {t.pos.discount.maxAmountHint(formatMax(permissions.maxAmount))}
            </p>
          ) : null}
          {type === 'percent' && permissions.maxPercent != null ? (
            <p className="text-muted-foreground text-xs">
              {t.pos.discount.maxPercentHint(permissions.maxPercent)}
            </p>
          ) : null}
          <Input
            placeholder={t.pos.payment.discountReason}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
          />
        </div>
      ) : null}
      {!permissions.canEdit || !permissions.canRemove ? (
        <Alert>
          <AlertDescription className="text-xs">
            {!permissions.canEdit ? t.pos.discount.editRestricted : ''}
            {!permissions.canRemove ? ` ${t.pos.discount.removeRestricted}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function formatMax(n: number): string {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })
}
