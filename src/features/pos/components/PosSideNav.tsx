import {
  LayoutList,
  Lock,
  LogOut,
  PauseCircle,
  PlusCircle,
  Wallet,
  Wrench,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { formatStaffRole, primaryStaffRole } from '@/features/pos/utils/role'
import type { PosContext } from '@/features/pos/types'
import { useSession } from '@/shared/session/SessionProvider'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type NavId = 'orders' | 'held' | 'shift' | 'ops'

type Props = {
  ctx: PosContext | undefined
  active: NavId
  heldCount: number
  onOrders: () => void
  onHeld: () => void
  onCreate: () => void
  onShift: () => void
  onOps: () => void
}

export function PosSideNav({
  ctx,
  active,
  heldCount,
  onOrders,
  onHeld,
  onCreate,
  onShift,
  onOps,
}: Props) {
  const navigate = useNavigate()
  const { staff, isManager, lock, signOut } = useSession()
  const roles = staff?.branches.map((b) => b.role) ?? []
  const role = formatStaffRole(primaryStaffRole(roles))
  const username = staff?.username ?? staff?.display_name ?? '—'
  const shiftRef = (ctx?.open_shift as { reference?: string } | null)?.reference

  async function onLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="z-10 flex w-[92px] shrink-0 flex-col bg-white shadow-[4px_0_24px_rgba(15,23,42,0.06)] sm:w-[120px]">
      <div className="border-b border-[#eef2f7] px-2 py-4 text-center">
        <p className="truncate text-sm font-bold text-[#0f172a]">{username}</p>
        <p className="text-[11px] text-[#64748b]">{role}</p>
        <p className="mt-1 text-[10px] text-[#94a3b8]" dir="ltr">
          {shiftRef ?? t.pos.shift.closedShort}
        </p>
      </div>

      <div className="p-2.5">
        <button
          type="button"
          onClick={onCreate}
          className="flex h-auto min-h-[76px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#22c55e] px-1 text-xs font-semibold leading-tight text-white shadow-[0_6px_16px_rgba(34,197,94,0.35)] hover:bg-[#16a34a]"
        >
          <PlusCircle className="size-7" />
          {t.pos.create.titleShort}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 p-2">
        <SideBtn
          active={active === 'orders'}
          icon={LayoutList}
          label={t.orders.hub.title}
          onClick={onOrders}
        />
        <SideBtn
          active={active === 'held'}
          icon={PauseCircle}
          label={`${t.pos.hold.title} (${heldCount})`}
          onClick={onHeld}
        />
        <SideBtn
          active={active === 'shift'}
          icon={Wallet}
          label={t.pos.ops.shiftSummary}
          onClick={onShift}
        />
        <SideBtn
          active={active === 'ops'}
          icon={Wrench}
          label={t.pos.ops.menu}
          onClick={onOps}
        />
      </nav>

      <div className="space-y-1 border-t border-[#eef2f7] p-2">
        {isManager ? (
          <Link
            to="/admin"
            className="flex min-h-10 items-center justify-center rounded-xl text-[10px] font-semibold text-[#2563eb] hover:bg-[#eff6ff]"
          >
            {t.pos.header.backToAdmin}
          </Link>
        ) : null}
        <SideBtn icon={Lock} label={t.pos.lock.action} onClick={() => lock()} />
        <SideBtn
          icon={LogOut}
          label={t.shell.signOut}
          onClick={() => void onLogout()}
        />
      </div>
    </aside>
  )
}

function SideBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof LayoutList
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[68px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-semibold transition-all',
        active
          ? 'bg-[#eff6ff] text-[#2563eb] shadow-[0_4px_12px_rgba(59,130,246,0.2)]'
          : 'text-[#64748b] hover:bg-[#f8fafc]',
      )}
    >
      <Icon className="size-5" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  )
}
