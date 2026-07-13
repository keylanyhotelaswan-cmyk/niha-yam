import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'

type RootErrorBoundaryProps = {
  children: ReactNode
}

type RootErrorBoundaryState = {
  hasError: boolean
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RootErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground text-center text-sm">
            Reload the application. If the problem persists, contact support.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )
    }

    return this.props.children
  }
}
