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
}

export function BridgeDownloadButton({
  variant = 'default',
  size = 'default',
  className,
}: Props) {
  const [manifest, setManifest] = useState<BridgeManifest | null>(null)

  useEffect(() => {
    void fetchBridgeManifest().then(setManifest)
  }, [])

  async function onDownload() {
    const latest = manifest ?? (await fetchBridgeManifest())
    setManifest(latest)
    if (!latest) {
      toast.error(t.print.download.unavailable)
      return
    }
    const a = document.createElement('a')
    a.href = latest.url || BRIDGE_DOWNLOAD.zipUrl
    a.download = latest.file
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(t.print.download.started)
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void onDownload()}
    >
      <Download className="size-4" aria-hidden />
      {t.print.download.button}
      {manifest?.version ? (
        <span className="text-primary-foreground/80 text-xs font-normal">
          v{manifest.version}
        </span>
      ) : null}
    </Button>
  )
}
