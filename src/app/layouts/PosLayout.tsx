import { Outlet } from 'react-router-dom'

/** Dedicated cashier shell — no admin chrome (ADR-0022). */
export function PosLayout() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <Outlet />
    </div>
  )
}
