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
import { Input } from '@/shared/components/ui/input'
import {
  freeSauceMenuItems,
  noteHasSauce,
  setCustomInNote,
  splitLineNote,
} from '@/features/pos/utils/line-note'
import type { PosCategory } from '@/features/pos/types'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  lineName: string
  initialNote?: string
  categories?: PosCategory[]
  /** Instant apply when tapping a free sauce chip. */
  onToggleSauce: (sauceName: string) => void
  /** Full merged note (sauces + smart custom text). */
  onSaveNote: (note: string) => void
}

export function LineExtrasDialog({
  open,
  onOpenChange,
  lineName,
  initialNote,
  categories,
  onToggleSauce,
  onSaveNote,
}: Props) {
  const [custom, setCustom] = useState('')
  const sauces = useMemo(() => freeSauceMenuItems(categories), [categories])
  const sauceNames = useMemo(() => sauces.map((s) => s.name), [sauces])

  // Load only the free-text portion when the dialog opens — sauces stay on chips.
  useEffect(() => {
    if (!open) return
    setCustom(splitLineNote(initialNote, sauceNames).custom)
    // intentionally not re-syncing on every sauce toggle (preserves typing)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open gate
  }, [open, lineName])

  function confirmNote() {
    onSaveNote(setCustomInNote(initialNote, custom, sauceNames))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t.pos.lineExtras.title}</DialogTitle>
          <p className="text-muted-foreground text-sm">{lineName}</p>
        </DialogHeader>

        <div className="space-y-4">
          {sauces.length > 0 ? (
            <div className="space-y-2">
              <Label>{t.pos.lineExtras.freeSauces}</Label>
              <div className="flex flex-wrap gap-2">
                {sauces.map((sauce) => {
                  const active = noteHasSauce(
                    initialNote,
                    sauce.name,
                    sauceNames,
                  )
                  return (
                    <button
                      key={sauce.id}
                      type="button"
                      onClick={() => onToggleSauce(sauce.name)}
                      className={cn(
                        'rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors',
                        active
                          ? 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
                          : 'border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f8fafc]',
                      )}
                    >
                      {sauce.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t.pos.lineExtras.noFreeSauces}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="line-note">{t.pos.lineExtras.note}</Label>
            <Input
              id="line-note"
              className="h-12 rounded-2xl"
              placeholder={t.pos.lineExtras.notePlaceholder}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmNote()
                }
              }}
            />
            <p className="text-[11px] text-[#94a3b8]">
              {t.pos.lineExtras.noteSmartHint}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {t.common.cancel}
          </Button>
          <Button type="button" className="flex-1" onClick={confirmNote}>
            {t.pos.lineExtras.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
