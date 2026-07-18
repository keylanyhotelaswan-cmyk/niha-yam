import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import {
  BRIDGE_DOWNLOAD,
  fetchBridgeManifest,
  type BridgeManifest,
} from '@/features/print/bridge-download'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/i18n'

type Props = {
  variant?: 'default' | 'outline' | 'secondary'
  size?: 'default' | 'sm' | 'lg'
  className?: string
  /** Prefer Setup.exe when published; otherwise zip. */
  preferSetup?: boolean
}

export function BridgeDownloadButton({
  variant = 'default',
  size = 'default',
  className,
  preferSetup = true,
}: Props) {
  const [manifest, setManifest] = useState<BridgeManifest | null>(null)

  useEffect(() => {
    void fetchBridgeManifest().then(setManifest)
  }, [])

  async function onDownload(kind: 'setup' | 'zip') {
    const latest = manifest ?? (await fetchBridgeManifest())
    setManifest(latest)
    if (!latest) {
      toast.error(t.print.download.unavailable)
      return
    }

    let href: string
    let file: string
    if (kind === 'setup' && preferSetup && latest.setupUrl) {
      href = latest.setupUrl
      file = latest.setupFile || 'NihaPrintBridge-Setup.exe'
    } else {
      href = latest.url || BRIDGE_DOWNLOAD.zipUrl
      file = latest.file || 'niha-print-bridge-win-x64.zip'
    }

    const a = document.createElement('a')
    a.href = href
    a.download = file
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(t.print.download.started)
  }

  const version = manifest?.version
  const setupReady = Boolean(manifest?.setupUrl)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => void onDownload(setupReady ? 'setup' : 'zip')}
      >
        <Download className="size-4" aria-hidden />
        {setupReady ? t.print.download.button : t.print.download.buttonZip}
        {version ? (
          <span className="text-primary-foreground/80 text-xs font-normal">
            v{version}
          </span>
        ) : null}
      </Button>
      {setupReady ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => void onDownload('zip')}
        >
          {t.print.download.buttonZip}
        </Button>
      ) : null}
    </div>
  )
}
