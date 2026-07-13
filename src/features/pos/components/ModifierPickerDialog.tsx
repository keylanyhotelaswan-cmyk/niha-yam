import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Label } from '@/shared/components/ui/label'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import type { PosMenuItem, PosModifierGroup } from '@/features/pos/types'
import { t } from '@/shared/i18n'

type Props = {
  item: PosMenuItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (modifierOptionIds: string[]) => void
}

function defaultSelections(groups: PosModifierGroup[]): string[] {
  const ids: string[] = []
  for (const group of groups) {
    const defaults = group.options.filter((o) => o.is_default).map((o) => o.id)
    if (defaults.length) {
      ids.push(...defaults.slice(0, Math.max(group.min_selections, 1)))
    } else if (group.min_selections > 0 && group.options[0]) {
      ids.push(group.options[0].id)
    }
  }
  return ids
}

export function ModifierPickerDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && item) {
      setSelected(defaultSelections(item.modifier_groups))
      setError(null)
    }
  }, [open, item])

  const groups = item?.modifier_groups ?? []

  function toggle(group: PosModifierGroup, optionId: string) {
    setSelected((prev) => {
      const inGroup = prev.filter((id) =>
        group.options.some((o) => o.id === id),
      )
      const has = inGroup.includes(optionId)
      let next = prev.filter((id) => id !== optionId)
      if (!has) {
        if (group.max_selections === 1) {
          next = next.filter(
            (id) => !group.options.some((o) => o.id === id),
          )
        }
        next = [...next, optionId]
      }
      return next
    })
  }

  function validate(): boolean {
    for (const group of groups) {
      const count = selected.filter((id) =>
        group.options.some((o) => o.id === id),
      ).length
      if (count < group.min_selections) {
        setError(t.pos.modifiers.minRequired(group.name, group.min_selections))
        return false
      }
      if (group.max_selections > 0 && count > group.max_selections) {
        setError(t.pos.modifiers.maxExceeded(group.name, group.max_selections))
        return false
      }
    }
    setError(null)
    return true
  }

  const preview = useMemo(() => {
    if (!item) return 0
    let unit = item.base_price
    for (const group of groups) {
      for (const id of selected) {
        const opt = group.options.find((o) => o.id === id)
        if (opt) unit += opt.price_delta
      }
    }
    return unit
  }, [item, groups, selected])

  if (!item) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {groups.map((group) => (
            <div key={group.id} className="space-y-2">
              <Label>
                {group.name}
                {group.min_selections > 0
                  ? ` (${t.pos.modifiers.required})`
                  : ''}
              </Label>
              <div className="flex flex-wrap gap-2">
                {group.options.map((opt) => {
                  const active = selected.includes(opt.id)
                  return (
                    <Button
                      key={opt.id}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      onClick={() => toggle(group, opt.id)}
                    >
                      {opt.name}
                      {opt.price_delta !== 0
                        ? ` (+${opt.price_delta})`
                        : ''}
                    </Button>
                  )
                })}
              </div>
            </div>
          ))}
          <p className="text-muted-foreground text-sm">
            {t.pos.cart.lineTotal}: {preview.toFixed(2)}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!validate()) return
              onConfirm(selected)
              onOpenChange(false)
            }}
          >
            {t.pos.modifiers.addToCart}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
