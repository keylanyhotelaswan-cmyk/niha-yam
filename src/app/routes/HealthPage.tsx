import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { checkSupabaseConnection } from '@/lib/supabase/health'
import { APP_NAME, APP_VERSION } from '@/shared/constants/app'

export function HealthPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['health', 'supabase'],
    queryFn: checkSupabaseConnection,
    retry: false,
  })

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="text-muted-foreground text-sm">Foundation health check</p>
      </div>

      <dl className="bg-card divide-y rounded-lg border text-sm">
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-medium">{APP_VERSION}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">Supabase URL</dt>
          <dd className="truncate font-medium">{data?.url ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-muted-foreground">Connection</dt>
          <dd className="font-medium">
            {isLoading || isFetching
              ? 'Checking…'
              : isError
                ? 'Error'
                : data?.ok
                  ? 'Configured'
                  : 'Not configured'}
          </dd>
        </div>
        {data?.message ? (
          <div className="text-muted-foreground p-4 text-xs">
            {data.message}
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void refetch()}>
          Recheck
        </Button>
        <Button asChild variant="secondary">
          <Link to="/login">Login shell</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/admin">Admin shell</Link>
        </Button>
        <Button asChild>
          <Link to="/pos">POS (التصميم المعتمد)</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/ui/pos-wireframe">Wireframe مرجعي فقط</Link>
        </Button>
      </div>
    </div>
  )
}
