import { AppProviders } from '@/app/providers/AppProviders'
import { AppRouter } from '@/app/routes/AppRouter'

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}
