import { useState } from 'react'
import { AdjustmentsTab } from '@/features/treasury/components/AdjustmentsTab'
import { ExpensesTab } from '@/features/treasury/components/ExpensesTab'
import { OverviewTab } from '@/features/treasury/components/OverviewTab'
import { SettingsTab } from '@/features/treasury/components/SettingsTab'
import { ShiftArchiveTab } from '@/features/treasury/components/ShiftArchiveTab'
import { TransfersTab } from '@/features/treasury/components/TransfersTab'
import {
  useAdjustments,
  useBalances,
  useExpenses,
  useOpenShift,
  usePaymentMethods,
  useTransfers,
  useTreasuries,
} from '@/features/treasury/hooks/useTreasuryQueries'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

const TABS = [
  'overview',
  'transfers',
  'expenses',
  'adjustments',
  'archive',
  'settings',
] as const
type Tab = (typeof TABS)[number]

export function TreasuryPage() {
  const [tab, setTab] = useState<Tab>('overview')

  const balances = useBalances()
  const openShift = useOpenShift()
  const treasuries = useTreasuries()
  const paymentMethods = usePaymentMethods()
  const transfers = useTransfers()
  const expenses = useExpenses()
  const adjustments = useAdjustments()

  const isLoading =
    balances.isLoading || treasuries.isLoading || openShift.isLoading
  const isError = balances.isError || treasuries.isError || openShift.isError

  return (
    <div className="space-y-6">
      <PageHeader title={t.treasury.title} description={t.treasury.subtitle} />

      <div
        role="tablist"
        aria-label={t.treasury.title}
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
            {t.treasury.tabs[value]}
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
              description={t.treasury.common.loadFailed}
              onRetry={() => {
                void balances.refetch()
                void treasuries.refetch()
                void openShift.refetch()
              }}
            />
          </CardContent>
        </Card>
      ) : tab === 'overview' ? (
        <OverviewTab
          balances={balances.data ?? []}
          openShift={openShift.data ?? null}
        />
      ) : tab === 'transfers' ? (
        <TransfersTab
          transfers={transfers.data ?? []}
          treasuries={treasuries.data ?? []}
        />
      ) : tab === 'expenses' ? (
        <ExpensesTab
          expenses={expenses.data ?? []}
          treasuries={treasuries.data ?? []}
        />
      ) : tab === 'adjustments' ? (
        <AdjustmentsTab
          adjustments={adjustments.data ?? []}
          treasuries={treasuries.data ?? []}
        />
      ) : tab === 'archive' ? (
        <ShiftArchiveTab />
      ) : (
        <SettingsTab
          treasuries={treasuries.data ?? []}
          paymentMethods={paymentMethods.data ?? []}
        />
      )}
    </div>
  )
}
