import { ChevronDown, LogOut } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { userMenuItems } from '@/app/navigation/admin-nav'
import { useSession } from '@/shared/session/SessionProvider'
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { t } from '@/shared/i18n'
import { cn } from '@/shared/utils/cn'

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '؟'
  return parts.map((part) => part.charAt(0)).join('')
}

export function AdminUserMenu() {
  const navigate = useNavigate()
  const { staff, signOut } = useSession()
  const displayName = staff?.display_name ?? ''

  async function onLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[10rem] truncate font-medium sm:block">
            {displayName}
          </span>
          <ChevronDown className="text-muted-foreground size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t.shell.userMenu.account}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {userMenuItems.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.id} asChild>
              <NavLink
                to={item.to}
                className={({ isActive }) => cn(isActive && 'bg-muted')}
              >
                <Icon className="text-muted-foreground size-4" aria-hidden />
                <span>{item.label}</span>
              </NavLink>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => void onLogout()}
        >
          <LogOut className="size-4" aria-hidden />
          <span>{t.shell.signOut}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
