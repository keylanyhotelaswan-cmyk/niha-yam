import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  fetchBridgeManifest,
  isBridgeUpdateAvailable,
  type BridgeManifest,
} from '@/features/print/bridge-download'
import { BridgeDownloadButton } from '@/features/print/components/BridgeDownloadButton'
import { formatWhen } from '@/features/print/components/print-labels'
import type { PrinterHealth } from '@/features/print/types'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent } from '@/shared/components/ui/card'
import { t } from '@/shared/i18n'

type Props = {
  health: PrinterHealth | undefined
}

export function PrintCenterStatusBar({ health }: Props) {
  const [manifest, setManifest] = useState<BridgeManifest | null>(null)

  useEffect(() => {
    void fetchBridgeManifest().then(setManifest)
  }, [])

  const bridges = useMemo(() => {
    if (!health) return []
    if (health.bridges?.length) return health.bridges
    return health.bridge ? [health.bridge] : []
  }, [health])

  const primary = bridges.find((b) => b.online) ?? bridges[0] ?? null
  const installedVersion = primary?.version ?? null
  const latestVersion = manifest?.version ?? null
  const updateNeeded = bridges.some((b) =>
    isBridgeUpdateAvailable(b.version, latestVersion),
  )
  const lastHeartbeat = primary?.last_heartbeat_at ?? null

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            label={t.print.ops.bridgeVersion}
            value={installedVersion ? `v${installedVersion}` : t.print.common.none}
          />
          <Stat
            label={t.print.ops.latestVersion}
            value={latestVersion ? `v${latestVersion}` : t.print.common.none}
          />
          <Stat
            label={t.print.health.lastHeartbeat}
            value={lastHeartbeat ? formatWhen(lastHeartbeat) : t.print.common.none}
          />
          <Stat
            label={t.print.health.pending}
            value={String(health?.queue.pending ?? 0)}
          />
          <Stat
            label={t.print.health.failed}
            value={String(health?.queue.failed ?? 0)}
            tone={
              (health?.queue.failed ?? 0) > 0 ? 'destructive' : undefined
            }
          />
        </CardContent>
      </Card>

      {updateNeeded ? (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <AlertTriangle className="size-4 text-amber-700" />
          <AlertTitle className="text-amber-950 dark:text-amber-100">
            {t.print.ops.updateAvailable}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-amber-900 dark:text-amber-100">
              {t.print.ops.updateBody(
                installedVersion ?? '—',
                latestVersion ?? '—',
              )}
            </span>
            <BridgeDownloadButton size="sm" />
          </AlertDescription>
        </Alert>
      ) : primary?.online ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="success">{t.print.ops.upToDate}</Badge>
          <span className="text-muted-foreground">
            {t.print.ops.currentAndLatest(
              installedVersion ?? '—',
              latestVersion ?? '—',
            )}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'destructive'
}) {
  return (
    <div className="rounded-lg border bg-white/60 px-3 py-2 dark:bg-transparent">
      <p className="text-muted-foreground text-[11px] font-semibold">{label}</p>
      <p
        className={
          tone === 'destructive'
            ? 'text-destructive mt-0.5 text-sm font-bold'
            : 'mt-0.5 text-sm font-bold'
        }
        dir="auto"
      >
        {value}
      </p>
    </div>
  )
}
