import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="bg-muted flex min-h-screen items-center justify-center p-6">
      <div className="bg-card w-full max-w-md rounded-lg border p-8 shadow-sm">
        <Outlet />
      </div>
    </div>
  )
}
