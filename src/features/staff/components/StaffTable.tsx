import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ChangePasswordDialog } from '@/features/staff/components/dialogs/ChangePasswordDialog'
import { EditStaffDialog } from '@/features/staff/components/dialogs/EditStaffDialog'
import { SetPinDialog } from '@/features/staff/components/dialogs/SetPinDialog'
import { StaffStatusDialog } from '@/features/staff/components/dialogs/StaffStatusDialog'
import { StaffRoleBadges } from '@/features/staff/components/StaffRoleBadges'
import type { StaffListItem } from '@/features/staff/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'

type StaffTableProps = {
  items: StaffListItem[]
  currentStaffId?: string
  canManage: boolean
}

type DialogState = {
  kind: 'edit' | 'password' | 'pin' | 'activate' | 'deactivate'
  member: StaffListItem
} | null

export function StaffTable({
  items,
  currentStaffId,
  canManage,
}: StaffTableProps) {
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)

  // Client-side search by name + username (no request — ADR-0010).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        (m.username ?? '').toLowerCase().includes(q),
    )
  }, [items, query])

  const columnCount = canManage ? 5 : 4

  return (
    <>
      <div className="p-4">
        <Input
          type="search"
          className="max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.staff.search.placeholder}
          aria-label={t.staff.search.placeholder}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.staff.team.colName}</TableHead>
            <TableHead>{t.staff.team.colUsername}</TableHead>
            <TableHead>{t.staff.team.colRole}</TableHead>
            <TableHead>{t.staff.team.colStatus}</TableHead>
            {canManage ? (
              <TableHead className="w-16 text-end">
                {t.staff.actions.rowActions}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className="text-muted-foreground py-8 text-center text-sm"
              >
                {t.staff.search.noResults}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((member) => {
              const isSelf = member.id === currentStaffId
              return (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.display_name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.username ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StaffRoleBadges branches={member.branches} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.is_active ? 'success' : 'secondary'}>
                      {member.is_active
                        ? t.staff.status.active
                        : t.staff.status.inactive}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.staff.actions.rowActions}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'edit', member })}
                          >
                            {t.staff.actions.edit}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setDialog({ kind: 'password', member })
                            }
                          >
                            {t.staff.actions.changePassword}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDialog({ kind: 'pin', member })}
                          >
                            {t.staff.actions.setPin}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {member.is_active ? (
                            <DropdownMenuItem
                              disabled={isSelf}
                              className="text-destructive focus:text-destructive"
                              onSelect={() =>
                                setDialog({ kind: 'deactivate', member })
                              }
                            >
                              {t.staff.actions.deactivate}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                setDialog({ kind: 'activate', member })
                              }
                            >
                              {t.staff.actions.activate}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>

      {dialog?.kind === 'edit' ? (
        <EditStaffDialog
          staff={dialog.member}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'password' ? (
        <ChangePasswordDialog
          staffId={dialog.member.id}
          staffName={dialog.member.display_name}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'pin' ? (
        <SetPinDialog
          staffId={dialog.member.id}
          staffName={dialog.member.display_name}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'activate' || dialog?.kind === 'deactivate' ? (
        <StaffStatusDialog
          staffId={dialog.member.id}
          staffName={dialog.member.display_name}
          activate={dialog.kind === 'activate'}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      ) : null}
    </>
  )
}
