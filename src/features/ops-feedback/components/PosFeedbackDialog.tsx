import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  submitOpsFeedback,
  uploadOpsFeedbackImage,
  type OpsFeedbackContext,
  type OpsFeedbackKind,
  type OpsFeedbackPriority,
} from '@/features/ops-feedback/api/opsFeedback.api'
import { APP_VERSION } from '@/shared/constants/app'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contextType?: OpsFeedbackContext | null
  contextId?: string | null
  bridgeVersion?: string | null
}

const KINDS: OpsFeedbackKind[] = ['problem', 'suggestion', 'inquiry', 'note']
const PRIOS: OpsFeedbackPriority[] = ['normal', 'important', 'urgent']

export function PosFeedbackDialog({
  open,
  onOpenChange,
  contextType,
  contextId,
  bridgeVersion,
}: Props) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<OpsFeedbackKind>('note')
  const [priority, setPriority] = useState<OpsFeedbackPriority>('normal')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setBody('')
      setKind('note')
      setPriority('normal')
      setFile(null)
    }
  }, [open])

  async function onSubmit() {
    if (title.trim().length < 2 || body.trim().length < 2) {
      toast.error(t.opsFeedback.sendFailed)
      return
    }
    setBusy(true)
    try {
      let imagePath: string | null = null
      if (file) imagePath = await uploadOpsFeedbackImage(file)
      await submitOpsFeedback({
        title: title.trim(),
        body: body.trim(),
        kind,
        priority,
        imagePath,
        contextType: contextType ?? 'none',
        contextId: contextId ?? null,
        deviceLabel: navigator.userAgent.slice(0, 180),
        appVersion: APP_VERSION,
        bridgeVersion: bridgeVersion ?? null,
      })
      toast.success(t.opsFeedback.sent)
      onOpenChange(false)
    } catch {
      toast.error(t.opsFeedback.sendFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.opsFeedback.cashierTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t.opsFeedback.cashierHint}</p>
        <p className="text-xs text-[#64748b]">{t.opsFeedback.autoLink}</p>

        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label>{t.opsFeedback.title}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.opsFeedback.titlePlaceholder}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.opsFeedback.body}</Label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t.opsFeedback.bodyPlaceholder}
              rows={4}
              maxLength={2000}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>
          <div className="space-y-1">
            <Label>{t.opsFeedback.kind}</Label>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                    kind === k
                      ? 'border-[#93c5fd] bg-[#eff6ff] text-[#1d4ed8]'
                      : 'border-[#e2e8f0] text-[#475569]',
                  )}
                  onClick={() => setKind(k)}
                >
                  {t.opsFeedback.kinds[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.opsFeedback.priority}</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRIOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                    priority === p
                      ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
                      : 'border-[#e2e8f0] text-[#475569]',
                  )}
                  onClick={() => setPriority(p)}
                >
                  {t.opsFeedback.priorities[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t.opsFeedback.photo}</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                {t.opsFeedback.photoPick}
              </Button>
              {file ? (
                <button
                  type="button"
                  className="text-xs text-[#b45309]"
                  onClick={() => setFile(null)}
                >
                  {file.name} · {t.opsFeedback.photoClear}
                </button>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => void onSubmit()}
          >
            {busy ? t.opsFeedback.submitting : t.opsFeedback.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
