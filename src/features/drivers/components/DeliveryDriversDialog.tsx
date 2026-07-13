import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Button } from '@/shared/components/ui/button'
import {
  listDeliveryDrivers,
  upsertDeliveryDriver,
} from '@/features/orders/api/orders.api'
import type { DeliveryDriver } from '@/features/drivers/types'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeliveryDriversDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<DeliveryDriver | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)

  const driversQuery = useQuery({
    queryKey: ['drivers', 'list'],
    queryFn: () => listDeliveryDrivers(false),
    enabled: open,
  })

  const drivers = driversQuery.data ?? []

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setShowForm(false)
      setName('')
      setPhone('')
      setNotes('')
      setActive(true)
    }
  }, [open])

  const saveMut = useMutation({
    mutationFn: () =>
      upsertDeliveryDriver({
        id: editing?.id,
        displayName: name.trim(),
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        isActive: active,
      }),
    onSuccess: () => {
      toast.success(t.drivers.saved)
      setEditing(null)
      setShowForm(false)
      setName('')
      setPhone('')
      setNotes('')
      setActive(true)
      void driversQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function startEdit(driver: DeliveryDriver) {
    setEditing(driver)
    setShowForm(true)
    setName(driver.display_name)
    setPhone(driver.phone ?? '')
    setNotes(driver.notes ?? '')
    setActive(driver.is_active)
  }

  function startAdd() {
    setEditing(null)
    setShowForm(true)
    setName('')
    setPhone('')
    setNotes('')
    setActive(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t.drivers.title}</DialogTitle>
        </DialogHeader>

        {!showForm && drivers.length === 0 && !driversQuery.isLoading ? (
          <div className="rounded-2xl border border-dashed border-[#fdba74] bg-[#fff7ed] p-6 text-center">
            <p className="mb-4 text-base font-semibold text-[#c2410c]">
              {t.drivers.empty}
            </p>
            <Button
              type="button"
              className="min-h-12 rounded-2xl bg-[#f97316] hover:bg-[#ea580c]"
              onClick={startAdd}
            >
              <Plus className="size-4" />
              {t.drivers.addNew}
            </Button>
          </div>
        ) : null}

        {showForm ? (
          <div className="space-y-3">
            <Input
              className="h-12 rounded-2xl text-base"
              placeholder={t.drivers.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              className="h-12 rounded-2xl text-base"
              placeholder={t.drivers.phone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
            />
            <Input
              className="h-12 rounded-2xl text-base"
              placeholder={t.drivers.notes}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              {t.drivers.active}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-12 flex-1 rounded-2xl"
                onClick={() => {
                  setShowForm(false)
                  setEditing(null)
                }}
              >
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                className="min-h-12 flex-[2] rounded-2xl"
                disabled={!name.trim() || saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                {editing ? t.drivers.update : t.drivers.add}
              </Button>
            </div>
          </div>
        ) : null}

        {!showForm && drivers.length > 0 ? (
          <>
            <Button
              type="button"
              className="mb-3 min-h-12 w-full rounded-2xl"
              onClick={startAdd}
            >
              <Plus className="size-4" />
              {t.drivers.addNew}
            </Button>
            <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
              {drivers.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-2xl border border-[#eef2f7] bg-white p-3"
                >
                  <div>
                    <p className="text-base font-semibold">
                      {d.display_name}
                      {!d.is_active ? (
                        <span className="text-muted-foreground ms-1 text-xs">
                          ({t.drivers.inactive})
                        </span>
                      ) : null}
                    </p>
                    {d.phone ? (
                      <p className="text-muted-foreground text-sm" dir="ltr">
                        {d.phone}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 rounded-xl px-4"
                    onClick={() => startEdit(d)}
                  >
                    {t.common.edit}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
