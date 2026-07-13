import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ModifierGroupDialog } from '@/features/menu/components/dialogs/ModifierGroupDialog'
import { ModifierOptionDialog } from '@/features/menu/components/dialogs/ModifierOptionDialog'
import {
  useSetModifierGroupStatus,
  useSetModifierOptionStatus,
} from '@/features/menu/hooks/useMenuMutations'
import type { ModifierGroup, ModifierOption } from '@/features/menu/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'

type ModifiersTabProps = {
  groups: ModifierGroup[]
}

type GroupDialogState = { group: ModifierGroup | null } | null
type OptionDialogState = {
  groupId: string
  option: ModifierOption | null
} | null

export function ModifiersTab({ groups }: ModifiersTabProps) {
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null)
  const [optionDialog, setOptionDialog] = useState<OptionDialogState>(null)
  const setGroupStatus = useSetModifierGroupStatus()
  const setOptionStatus = useSetModifierOptionStatus()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{t.menu.modifiers.heading}</h2>
        <Button size="sm" onClick={() => setGroupDialog({ group: null })}>
          {t.menu.modifiers.addGroup}
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t.menu.modifiers.empty}
            <p className="mt-1">{t.menu.modifiers.emptyDescription}</p>
          </CardContent>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.id}>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  {group.name}
                  <Badge variant={group.is_active ? 'success' : 'secondary'}>
                    {group.is_active
                      ? t.menu.status.active
                      : t.menu.status.inactive}
                  </Badge>
                </CardTitle>
                <p className="text-muted-foreground text-xs">
                  {t.menu.modifiers.selectionRange(
                    group.min_selections,
                    group.max_selections,
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOptionDialog({ groupId: group.id, option: null })
                  }
                >
                  {t.menu.modifiers.addOption}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t.menu.common.rowActions}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setGroupDialog({ group })}
                    >
                      {t.menu.modifiers.editGroup}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        setGroupStatus.mutate({
                          id: group.id,
                          active: !group.is_active,
                        })
                      }
                    >
                      {group.is_active
                        ? t.menu.categories.deactivate
                        : t.menu.categories.activate}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {group.options.length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">
                  {t.menu.modifiers.noOptions}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.menu.modifiers.optionName}</TableHead>
                      <TableHead className="w-28">
                        {t.menu.modifiers.priceDelta}
                      </TableHead>
                      <TableHead className="w-28">
                        {t.menu.modifiers.isDefault}
                      </TableHead>
                      <TableHead className="w-28">
                        {t.menu.items.colStatus}
                      </TableHead>
                      <TableHead className="w-16 text-end">
                        {t.menu.common.rowActions}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.options.map((option) => (
                      <TableRow key={option.id}>
                        <TableCell className="font-medium">
                          {option.name}
                        </TableCell>
                        <TableCell>{option.price_delta.toFixed(2)}</TableCell>
                        <TableCell>{option.is_default ? '✓' : '—'}</TableCell>
                        <TableCell>
                          <Badge
                            variant={option.is_active ? 'success' : 'secondary'}
                          >
                            {option.is_active
                              ? t.menu.status.active
                              : t.menu.status.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t.menu.common.rowActions}
                              >
                                <MoreHorizontal
                                  className="size-4"
                                  aria-hidden
                                />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  setOptionDialog({
                                    groupId: group.id,
                                    option,
                                  })
                                }
                              >
                                {t.menu.modifiers.editOption}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() =>
                                  setOptionStatus.mutate({
                                    id: option.id,
                                    active: !option.is_active,
                                  })
                                }
                              >
                                {option.is_active
                                  ? t.menu.categories.deactivate
                                  : t.menu.categories.activate}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {groupDialog ? (
        <ModifierGroupDialog
          group={groupDialog.group}
          open
          onOpenChange={(next) => !next && setGroupDialog(null)}
        />
      ) : null}

      {optionDialog ? (
        <ModifierOptionDialog
          groupId={optionDialog.groupId}
          option={optionDialog.option}
          open
          onOpenChange={(next) => !next && setOptionDialog(null)}
        />
      ) : null}
    </div>
  )
}
