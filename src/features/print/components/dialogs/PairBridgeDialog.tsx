import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { buildPairPayload } from '@/features/print/bridge-download'
import { formatWhen } from '@/features/print/components/print-labels'
import { useCreatePairCode } from '@/features/print/hooks/usePrintMutations'
import type { PairCodeResult } from '@/features/print/types'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PairBridgeDialog({ open, onOpenChange }: Props) {
  const create = useCreatePairCode()
  const [result, setResult] = useState<PairCodeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next) {
      setResult(null)
      setError(null)
      setQrDataUrl(null)
      setAdvancedOpen(false)
    }
    onOpenChange(next)
  }

  useEffect(() => {
    if (!result?.code) {
      setQrDataUrl(null)
      return
    }
    const payload = buildPairPayload(result.code)
    void QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl)
  }, [result])

  function generate() {
    setError(null)
    create.mutate(undefined, {
      onSuccess: (data) => setResult(data),
      onError: (e: Error) => setError(e.message),
    })
  }

  async function copyCode() {
    if (!result?.code) return
    try {
      await navigator.clipboard.writeText(result.code)
      toast.success(t.print.pair.copied)
    } catch {
      toast.error(t.print.errors.generic)
    }
  }

  async function copyPayload() {
    if (!result?.code) return
    try {
      await navigator.clipboard.writeText(buildPairPayload(result.code))
      toast.success(t.print.pair.payloadCopied)
    } catch {
      toast.error(t.print.errors.generic)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.print.pair.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{t.print.pair.hint}</p>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <div className="space-y-3 rounded-md border p-4 text-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t.print.pair.qrAlt}
                  className="mx-auto size-[220px] rounded-md bg-white p-2"
                />
              ) : null}
              <p className="text-muted-foreground text-xs">{t.print.pair.code}</p>
              <p className="font-mono text-3xl font-bold tracking-widest">
                {result.code}
              </p>
              <p className="text-muted-foreground text-xs">
                {t.print.pair.expires}: {formatWhen(result.expires_at)}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={copyCode}>
                {t.print.pair.copy}
              </Button>
              <p className="text-muted-foreground text-xs">{t.print.pair.qrHint}</p>

              <div className="border-t pt-3 text-start">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen
                    ? t.print.pair.hideAdvanced
                    : t.print.pair.advanced}
                </Button>
                {advancedOpen ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-muted-foreground text-xs">
                      {t.print.pair.advancedHint}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyPayload()}
                    >
                      {t.print.pair.copyPayload}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <Button
              type="button"
              className="w-full"
              loading={create.isPending}
              onClick={generate}
            >
              {t.print.pair.create}
            </Button>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.print.pair.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
