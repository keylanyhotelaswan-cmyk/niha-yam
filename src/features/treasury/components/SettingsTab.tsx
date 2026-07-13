import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { PaymentMethodDialog } from '@/features/treasury/components/dialogs/PaymentMethodDialog'
import { TreasuryDialog } from '@/features/treasury/components/dialogs/TreasuryDialog'
import {
  useSetPaymentMethodStatus,
  useSetTreasuryStatus,
} from '@/features/treasury/hooks/useTreasuryMutations'
import type {
  PaymentMethodRow,
  TreasuryRow,
} from '@/features/treasury/types'
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

type Props = {
  treasuries: TreasuryRow[]
  paymentMethods: PaymentMethodRow[]
}
type TreasuryDialogState = { treasury: TreasuryRow | null } | null

export function SettingsTab({ treasuries, paymentMethods }: Props) {
  const [treasuryDialog, setTreasuryDialog] =
    useState<TreasuryDialogState>(null)
  const [mappingMethod, setMappingMethod] = useState<PaymentMethodRow | null>(
    null,
  )

  const setTreasuryStatus = useSetTreasuryStatus()
  const setMethodStatus = useSetPaymentMethodStatus()

  const treasuryName = useMemo(() => {
    const map = new Map(treasuries.map((tr) => [tr.id, tr.name]))
    return (id: string | null) =>
      id ? (map.get(id) ?? t.treasury.common.none) : t.treasury.settings.unlinked
  }, [treasuries])

  function toggleTreasury(tr: TreasuryRow) {
    setTreasuryStatus.mutate(
      { id: tr.id, active: !tr.is_active },
      {
        onSuccess: () => toast.success(t.treasury.settings.statusChanged),
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  function toggleMethod(pm: PaymentMethodRow) {
    setMethodStatus.mutate(
      { id: pm.id, active: !pm.is_active },
      {
        onSuccess: () => toast.success(t.treasury.settings.statusChanged),
        onError: (e: Error) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.treasury.settings.treasuriesHeading}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTreasuryDialog({ treasury: null })}
          >
            {t.treasury.settings.addTreasury}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.treasury.settings.treasuryName}</TableHead>
                <TableHead>{t.treasury.settings.treasuryTypeLabel}</TableHead>
                <TableHead className="w-24">
                  {t.treasury.settings.sortOrder}
                </TableHead>
                <TableHead className="w-28">
                  {t.treasury.common.status}
                </TableHead>
                <TableHead className="w-16 text-end">
                  {t.treasury.common.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {treasuries.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {tr.name}
                      {tr.is_shift_drawer ? (
                        <Badge variant="info">
                          {t.treasury.overview.drawer}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t.treasury.treasuryType[tr.type]}
                  </TableCell>
                  <TableCell>{tr.sort_order}</TableCell>
                  <TableCell>
                    <Badge variant={tr.is_active ? 'success' : 'secondary'}>
                      {tr.is_active
                        ? t.treasury.status.executed
                        : t.treasury.overview.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.treasury.common.actions}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setTreasuryDialog({ treasury: tr })}
                        >
                          {t.treasury.settings.editTreasury}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => toggleTreasury(tr)}>
                          {tr.is_active
                            ? t.treasury.settings.deactivate
                            : t.treasury.settings.activate}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.treasury.settings.paymentMethodsHeading}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.treasury.settings.methodName}</TableHead>
                <TableHead>{t.treasury.settings.mappedTreasury}</TableHead>
                <TableHead className="w-28">
                  {t.treasury.common.status}
                </TableHead>
                <TableHead className="w-16 text-end">
                  {t.treasury.common.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentMethods.map((pm) => (
                <TableRow key={pm.id}>
                  <TableCell className="font-medium">{pm.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {treasuryName(pm.treasury_id)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={pm.is_active ? 'success' : 'secondary'}>
                      {pm.is_active
                        ? t.treasury.status.executed
                        : t.treasury.overview.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t.treasury.common.actions}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setMappingMethod(pm)}
                        >
                          {t.treasury.settings.changeMapping}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => toggleMethod(pm)}>
                          {pm.is_active
                            ? t.treasury.settings.deactivate
                            : t.treasury.settings.activate}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {treasuryDialog ? (
        <TreasuryDialog
          open
          treasury={treasuryDialog.treasury}
          onOpenChange={(next) => !next && setTreasuryDialog(null)}
        />
      ) : null}
      {mappingMethod ? (
        <PaymentMethodDialog
          open
          method={mappingMethod}
          treasuries={treasuries}
          onOpenChange={(next) => !next && setMappingMethod(null)}
        />
      ) : null}
    </div>
  )
}
