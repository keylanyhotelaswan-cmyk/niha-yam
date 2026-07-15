import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE,
  type DiscountPermissionConfig,
} from '@/shared/access/discountPermissions'
import type { StaffRole } from '@/shared/types/identity'
import { t } from '@/shared/i18n'

type Props = {
  role: StaffRole
  value: DiscountPermissionConfig
  onChange: (next: DiscountPermissionConfig) => void
  readOnly?: boolean
}

export function DiscountPermissionsSection({
  role,
  value,
  onChange,
  readOnly,
}: Props) {
  const defaults = DEFAULT_DISCOUNT_PERMISSIONS_BY_ROLE[role]

  function patch(partial: Partial<DiscountPermissionConfig>) {
    if (readOnly) return
    onChange({ ...value, ...partial })
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div>
        <p className="text-sm font-semibold">{t.staff.form.discountSection}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.staff.form.discountSectionHint}
        </p>
      </div>

      <CheckboxRow
        label={t.staff.form.discountManual}
        checked={value.manual}
        disabled={readOnly}
        onChange={(manual) =>
          patch(
            manual
              ? {
                  manual: true,
                  typeAmount: value.typeAmount || true,
                  typePercent: value.typePercent || true,
                  canEdit: value.canEdit || true,
                  canRemove: value.canRemove || true,
                }
              : { manual: false },
          )
        }
      />
      <CheckboxRow
        label={t.staff.form.discountTypeAmount}
        checked={value.typeAmount}
        disabled={readOnly || !value.manual}
        onChange={(typeAmount) => patch({ typeAmount })}
      />
      <CheckboxRow
        label={t.staff.form.discountTypePercent}
        checked={value.typePercent}
        disabled={readOnly || !value.manual}
        onChange={(typePercent) => patch({ typePercent })}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t.staff.form.discountMaxAmount}</Label>
          <Input
            type="number"
            min={0}
            dir="ltr"
            disabled={readOnly || !value.manual}
            placeholder={defaults.maxAmount != null ? String(defaults.maxAmount) : '—'}
            value={value.maxAmount ?? ''}
            onChange={(e) =>
              patch({
                maxAmount: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.staff.form.discountMaxPercent}</Label>
          <Input
            type="number"
            min={0}
            max={100}
            dir="ltr"
            disabled={readOnly || !value.manual}
            placeholder={defaults.maxPercent != null ? String(defaults.maxPercent) : '—'}
            value={value.maxPercent ?? ''}
            onChange={(e) =>
              patch({
                maxPercent: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </div>
      </div>

      <CheckboxRow
        label={t.staff.form.discountCanEdit}
        checked={value.canEdit}
        disabled={readOnly || !value.manual}
        onChange={(canEdit) => patch({ canEdit })}
      />
      <CheckboxRow
        label={t.staff.form.discountCanRemove}
        checked={value.canRemove}
        disabled={readOnly || !value.manual}
        onChange={(canRemove) => patch({ canRemove })}
      />
    </div>
  )
}

function CheckboxRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}
