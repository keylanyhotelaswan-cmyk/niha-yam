import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/query/client'
import { RootErrorBoundary } from '@/app/providers/RootErrorBoundary'
import { SessionProvider } from '@/shared/session/SessionProvider'

type AppProvidersProps = {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {children}
          <Toaster richColors position="top-center" />
        </SessionProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  )
}
