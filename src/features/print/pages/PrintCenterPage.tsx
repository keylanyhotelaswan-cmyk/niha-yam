import { useState } from 'react'
import { BridgeDownloadButton } from '@/features/print/components/BridgeDownloadButton'
import { DiagnosticsTab } from '@/features/print/components/DiagnosticsTab'
import { HealthTab } from '@/features/print/components/HealthTab'
import { LayoutTab } from '@/features/print/components/LayoutTab'
import { LogsTab } from '@/features/print/components/LogsTab'
import { PrintCenterStatusBar } from '@/features/print/components/PrintCenterStatusBar'
import { PrintersTab } from '@/features/print/components/PrintersTab'
import { QueueTab } from '@/features/print/components/QueueTab'
import { SettingsTab } from '@/features/print/components/SettingsTab'
import { TemplatesTab } from '@/features/print/components/TemplatesTab'
import { TestingPrintArmedBanner } from '@/features/print/components/TestingPrintArmedBanner'
import {
  usePrinterHealth,
  usePrinters,
  usePrintBridges,
  usePrintJobs,
  usePrintSettings,
  usePrintTemplates,
} from '@/features/print/hooks/usePrintQueries'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

const TABS = [
  'health',
  'diagnostics',
  'printers',
  'layout',
  'settings',
  'templates',
  'queue',
  'logs',
] as const
type Tab = (typeof TABS)[number]

export function PrintCenterPage() {
  const [tab, setTab] = useState<Tab>('health')

  const health = usePrinterHealth()
  const printers = usePrinters()
  const bridges = usePrintBridges()
  const templates = usePrintTemplates()
  const settings = usePrintSettings()
  const jobs = usePrintJobs(null)
  const expiredJobs = usePrintJobs('expired')

  const isLoading =
    health.isLoading ||
    printers.isLoading ||
    templates.isLoading ||
    settings.isLoading
  const isError =
    health.isError ||
    printers.isError ||
    templates.isError ||
    settings.isError

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.print.title}
        description={t.print.subtitle}
        actions={<BridgeDownloadButton />}
      />

      <TestingPrintArmedBanner />

      {!isLoading && !isError ? (
        <PrintCenterStatusBar health={health.data} />
      ) : null}

      <div
        role="tablist"
        aria-label={t.print.title}
        className="border-border flex flex-wrap gap-1 border-b"
      >
        {TABS.map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant="ghost"
            className={cn(
              'rounded-none border-b-2 border-transparent',
              tab === value && 'border-primary text-primary',
            )}
            onClick={() => setTab(value)}
          >
            {t.print.tabs[value]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <LoadingState />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="p-0">
            <ErrorState
              description={t.print.common.loadFailed}
              onRetry={() => {
                void health.refetch()
                void printers.refetch()
                void templates.refetch()
                void settings.refetch()
                void jobs.refetch()
              }}
            />
          </CardContent>
        </Card>
      ) : tab === 'health' ? (
        <HealthTab
          health={health.data!}
          expiredJobs={expiredJobs.data ?? []}
        />
      ) : tab === 'diagnostics' ? (
        <DiagnosticsTab printers={printers.data ?? []} />
      ) : tab === 'printers' ? (
        <PrintersTab printers={printers.data ?? []} />
      ) : tab === 'layout' ? (
        <LayoutTab />
      ) : tab === 'settings' ? (
        <SettingsTab settings={settings.data!} />
      ) : tab === 'templates' ? (
        <TemplatesTab templates={templates.data ?? []} />
      ) : tab === 'queue' ? (
        <QueueTab
          jobs={jobs.data ?? []}
          printers={printers.data ?? []}
          bridges={bridges.data ?? []}
        />
      ) : (
        <LogsTab jobs={jobs.data ?? []} />
      )}
    </div>
  )
}
