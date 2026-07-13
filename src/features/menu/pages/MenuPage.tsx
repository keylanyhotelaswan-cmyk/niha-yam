import { useState } from 'react'
import { ModifiersTab } from '@/features/menu/components/ModifiersTab'
import { ProductsTab } from '@/features/menu/components/ProductsTab'
import { useMenuAdmin } from '@/features/menu/hooks/useMenuAdmin'
import { useModifierGroups } from '@/features/menu/hooks/useModifierGroups'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Tab = 'products' | 'modifiers'

export function MenuPage() {
  const [tab, setTab] = useState<Tab>('products')
  const menuQuery = useMenuAdmin()
  const groupsQuery = useModifierGroups()

  const isLoading = menuQuery.isLoading || groupsQuery.isLoading
  const isError = menuQuery.isError || groupsQuery.isError

  return (
    <div className="space-y-6">
      <PageHeader title={t.menu.title} description={t.menu.subtitle} />

      <div
        role="tablist"
        aria-label={t.menu.title}
        className="border-border flex gap-1 border-b"
      >
        {(['products', 'modifiers'] as const).map((value) => (
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
            {value === 'products'
              ? t.menu.tabs.products
              : t.menu.tabs.modifiers}
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
              description={t.menu.common.loadFailed}
              onRetry={() => {
                void menuQuery.refetch()
                void groupsQuery.refetch()
              }}
            />
          </CardContent>
        </Card>
      ) : tab === 'products' ? (
        <ProductsTab
          categories={menuQuery.data?.categories ?? []}
          items={menuQuery.data?.items ?? []}
          modifierGroups={groupsQuery.data ?? []}
        />
      ) : (
        <ModifiersTab groups={groupsQuery.data ?? []} />
      )}
    </div>
  )
}
