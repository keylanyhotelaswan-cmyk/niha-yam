import { useMemo, useState } from 'react'
import type { DesignerCatalogGroup, DesignerCatalogItem } from '@/features/print/layout/designer-catalog'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: DesignerCatalogGroup[]
  /** Items already on the document (visible). */
  onDocumentKeys: Set<string>
  onAdd: (items: DesignerCatalogItem[]) => void
}

export function AddElementDialog({
  open,
  onOpenChange,
  groups,
  onDocumentKeys,
  onAdd,
}: Props) {
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  )

  const groupLabels = t.print.layout.catalogGroups as Record<string, string>
  const fieldLabels = t.print.layout.fields as Record<string, string>

  function closeAll() {
    setActiveGroupId(null)
    setSelected(new Set())
    onOpenChange(false)
  }

  function openGroup(id: string) {
    setActiveGroupId(id)
    setSelected(new Set())
  }

  function toggleItem(id: string, alreadyOn: boolean) {
    if (alreadyOn) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirmAdd() {
    if (!activeGroup) return
    const items = activeGroup.items.filter((it) => selected.has(it.id))
    if (items.length === 0) return
    onAdd(items)
    closeAll()
  }

  return (
    <>
      <Dialog
        open={open && !activeGroupId}
        onOpenChange={(v) => {
          if (!v) closeAll()
          else onOpenChange(true)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.print.layout.addElement}</DialogTitle>
            <DialogDescription>{t.print.layout.addElementHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {groups.map((g) => {
              const available = g.items.filter((it) => !onDocumentKeys.has(it.id))
                .length
              return (
                <button
                  key={g.id}
                  type="button"
                  className={cn(
                    'border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border px-3 py-3 text-start transition-colors',
                    available === 0 && 'opacity-60',
                  )}
                  onClick={() => openGroup(g.id)}
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {groupLabels[g.labelKey] ?? g.labelKey}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {g.items.length} {t.print.layout.fieldsCount}
                      {available < g.items.length
                        ? ` · ${available} ${t.print.layout.availableToAdd}`
                        : null}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-sm">◂</span>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open && !!activeGroupId}
        onOpenChange={(v) => {
          if (!v) {
            setActiveGroupId(null)
            setSelected(new Set())
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {activeGroup
                ? (groupLabels[activeGroup.labelKey] ?? activeGroup.labelKey)
                : t.print.layout.addElement}
            </DialogTitle>
            <DialogDescription>
              {t.print.layout.addGroupFieldsHint}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {activeGroup?.items.map((it) => {
              const onDoc = onDocumentKeys.has(it.id)
              const checked = onDoc || selected.has(it.id)
              return (
                <label
                  key={it.id}
                  className={cn(
                    'border-border flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
                    onDoc && 'bg-muted/40',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={onDoc}
                    onChange={() => toggleItem(it.id, onDoc)}
                  />
                  <span className="flex-1">
                    {fieldLabels[it.labelKey] ?? it.fieldId}
                  </span>
                  {onDoc ? (
                    <span className="text-muted-foreground text-xs">
                      {t.print.layout.alreadyOnDocument}
                    </span>
                  ) : null}
                </label>
              )
            })}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setActiveGroupId(null)
                setSelected(new Set())
              }}
            >
              {t.print.layout.backToGroups}
            </Button>
            <Button
              type="button"
              disabled={selected.size === 0}
              onClick={confirmAdd}
            >
              {t.print.layout.addSelected}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
