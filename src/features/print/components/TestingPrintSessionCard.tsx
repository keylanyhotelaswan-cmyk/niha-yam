import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { PairBridgeDialog } from '@/features/print/components/dialogs/PairBridgeDialog'
import {
  useBootstrapTestPrintEnvironment,
  useEnqueueTestPrint,
  useSetTestingPrintEnabled,
} from '@/features/print/hooks/usePrintMutations'
import { usePrintOpsSettings } from '@/features/print/hooks/usePrintQueries'
import type { PrinterHealth, PrinterRow } from '@/features/print/types'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { isTestingEnv } from '@/shared/config/appEnv'
import { t } from '@/shared/i18n'

type Props = {
  health: PrinterHealth | undefined
  printers: PrinterRow[]
  onRetryHealth: () => void
}

type SessionState = 'offline' | 'unpaired' | 'ready' | 'armed'

export function TestingPrintSessionCard({
  health,
  printers,
  onRetryHealth,
}: Props) {
  const testingUi = isTestingEnv()
  const ops = usePrintOpsSettings()
  const bootstrap = useBootstrapTestPrintEnvironment()
  const setTestingPrint = useSetTestingPrintEnabled()
  const testPrint = useEnqueueTestPrint()
  const [pairOpen, setPairOpen] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    if (!testingUi || bootstrapped) return
    void bootstrap
      .mutateAsync()
      .then(() => {
        setBootstrapped(true)
        void ops.refetch()
      })
      .catch(() => {
        /* diagnose / start will surface */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on Testing mount
  }, [testingUi, bootstrapped])

  const bridges = useMemo(() => {
    if (!health) return []
    if (health.bridges?.length) return health.bridges
    return health.bridge ? [health.bridge] : []
  }, [health])

  const anyOnline = bridges.some((b) => b.online)
  const armed = Boolean(ops.data?.testing_print_enabled)

  const state: SessionState = !anyOnline
    ? bridges.length === 0
      ? 'unpaired'
      : 'offline'
    : armed
      ? 'armed'
      : 'ready'

  if (!testingUi) return null

  const startSession = async () => {
    if (!anyOnline) {
      toast.error(t.print.session.bridgeOfflineBody)
      onRetryHealth()
      return
    }
    try {
      try {
        await bootstrap.mutateAsync()
      } catch {
        /* may already be bootstrapped */
      }
      await setTestingPrint.mutateAsync(true)
      await ops.refetch()
      toast.success(t.print.session.startedToast)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const endSession = async () => {
    try {
      await setTestingPrint.mutateAsync(false)
      await ops.refetch()
      toast.success(t.print.session.stoppedToast)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const runTestPage = async () => {
    const cashier =
      printers.find((p) => p.role === 'cashier' && p.is_active) ??
      printers.find((p) => p.is_active)
    if (!cashier) {
      toast.error(t.print.diagnostics.noPrinter)
      return
    }
    try {
      await testPrint.mutateAsync(cashier.id)
      toast.success(t.print.diagnostics.testQueued)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  const busy =
    setTestingPrint.isPending ||
    testPrint.isPending ||
    bootstrap.isPending ||
    ops.isFetching

  return (
    <>
      <Card
        className={
          state === 'armed'
            ? 'border-2 border-red-600 bg-red-50/80 dark:bg-red-950/30'
            : state === 'offline'
              ? 'border-2 border-red-500/50 bg-red-50/50 dark:bg-red-950/20'
              : 'border-amber-500/40 bg-amber-500/5'
        }
      >
        <CardHeader className="space-y-1">
          <CardTitle>{t.print.session.title}</CardTitle>
          <p className="text-muted-foreground text-sm">{t.print.session.hint}</p>
          <p className="text-muted-foreground text-xs">{t.print.session.opsRule}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'offline' ? (
            <Alert className="border-red-600 bg-red-100/80 dark:bg-red-950/40">
              <WifiOff className="size-4 text-red-700" />
              <AlertTitle className="font-bold">
                {t.print.session.bridgeOfflineTitle}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{t.print.session.bridgeOfflineBody}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRetryHealth()}
                  >
                    {t.print.session.retry}
                  </Button>
                  <Button variant="secondary" asChild>
                    <a href="/downloads/niha-print-bridge-win-x64.zip">
                      {t.print.session.openBridge}
                    </a>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {state === 'unpaired' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm">
                <p>{t.print.session.unpairedBody}</p>
                <p className="text-muted-foreground text-xs">
                  {t.print.session.pairOnceHint}
                </p>
              </div>
              <Button onClick={() => setPairOpen(true)} disabled={busy}>
                {t.print.session.pairOnce}
              </Button>
            </div>
          ) : null}

          {state === 'ready' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">{t.print.session.readyBody}</p>
              <Button onClick={() => void startSession()} disabled={busy}>
                {t.print.session.start}
              </Button>
            </div>
          ) : null}

          {state === 'armed' ? (
            <>
              <Alert className="border-red-600 bg-red-100/80 dark:bg-red-950/40">
                <AlertTriangle className="size-4 text-red-700" />
                <AlertTitle className="font-bold">
                  {t.print.session.armedTitle}
                </AlertTitle>
                <AlertDescription>{t.print.session.armedBody}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  onClick={() => void endSession()}
                  disabled={busy}
                >
                  {t.print.session.stop}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void runTestPage()}
                  disabled={busy}
                >
                  {t.print.session.testPage}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <PairBridgeDialog open={pairOpen} onOpenChange={setPairOpen} />
    </>
  )
}
