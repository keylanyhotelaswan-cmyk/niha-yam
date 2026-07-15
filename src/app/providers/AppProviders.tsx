import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/query/client'
import { RootErrorBoundary } from '@/app/providers/RootErrorBoundary'
import { SessionProvider } from '@/shared/session/SessionProvider'
import { TestingEnvBanner } from '@/shared/components/TestingEnvBanner'
import { isTestingEnv } from '@/shared/config/appEnv'

type AppProvidersProps = {
  children: ReactNode
}

if (typeof document !== 'undefined' && isTestingEnv()) {
  document.title = `🧪 Testing · ${document.title || 'NIHA'}`
}

export function AppProviders({ children }: AppProvidersProps) {
  const testing = isTestingEnv()
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <TestingEnvBanner />
          <div className={testing ? 'pt-8' : undefined}>{children}</div>
          <Toaster richColors position="top-center" />
        </SessionProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  )
}
