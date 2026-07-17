import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { usePrintOpsSettings } from '@/features/print/hooks/usePrintQueries'
import { useSetTestingPrintEnabled } from '@/features/print/hooks/usePrintMutations'
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { isTestingEnv } from '@/shared/config/appEnv'
import { t } from '@/shared/i18n'

/**
 * Persistent Print Center warning while Testing print claim is armed.
 * Does not change Bridge architecture — ops toggle only.
 */
export function TestingPrintArmedBanner() {
  const testingUi = isTestingEnv()
  const ops = usePrintOpsSettings()
  const setTestingPrint = useSetTestingPrintEnabled()

  if (!testingUi) return null
  if (!ops.data?.testing_print_enabled) return null

  const turnOff = async () => {
    try {
      await setTestingPrint.mutateAsync(false)
      toast.success(t.print.diagnostics.testingPrintToggledOff)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.print.errors.generic)
    }
  }

  return (
    <Alert
      role="status"
      aria-live="assertive"
      className="border-2 border-red-600 bg-red-50 text-red-950 dark:border-red-500 dark:bg-red-950/50 dark:text-red-50"
    >
      <AlertTriangle className="size-5 text-red-700 dark:text-red-300" />
      <AlertTitle className="text-base font-bold tracking-wide">
        {t.print.diagnostics.testingPrintArmedTitle}
      </AlertTitle>
      <AlertDescription className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm leading-relaxed text-red-900 dark:text-red-100">
          {t.print.diagnostics.testingPrintArmedBody}
        </span>
        <Button
          variant="destructive"
          className="shrink-0"
          disabled={setTestingPrint.isPending}
          onClick={() => void turnOff()}
        >
          {t.print.diagnostics.testingPrintOffNow}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
