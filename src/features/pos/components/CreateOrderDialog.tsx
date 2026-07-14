import { useEffect, useState } from 'react'
import { Bike, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import {
  fetchCustomerProfile,
  searchCustomers,
  upsertCustomer,
} from '@/features/customers/api/customers.api'
import type {
  CustomerAddress,
  CustomerListItem,
} from '@/features/customers/types'
import { DeliveryDriversDialog } from '@/features/drivers/components/DeliveryDriversDialog'
import { usePosContext } from '@/features/pos/hooks/usePosQueries'
import type { PosOrderType } from '@/features/orders/types'
import type { PosPayMode } from '@/features/pos/state/pos-draft'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

export type CreateOrderResult = {
  orderType: PosOrderType
  payMode: PosPayMode
  customerMode: 'walkin' | 'pick' | 'new'
  customerId: string | null
  customerName: string
  customerPhone: string
  deliveryAddress: string
  deliveryZone: string
  dineInTableRef: string
  deliveryDriverId: string | null
  orderNote: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (result: CreateOrderResult) => void
  /** Call Center: force unpaid (pay later) only. */
  unpaidOnly?: boolean
}

export function CreateOrderDialog({
  open,
  onOpenChange,
  onCreate,
  unpaidOnly = false,
}: Props) {
  const ctx = usePosContext().data
  const drivers = (ctx?.delivery_drivers ?? []).filter((d) => d.is_active)
  const canManageDrivers = Boolean(ctx?.can_manage_drivers)

  const [orderType, setOrderType] = useState<PosOrderType>('takeaway')
  const [payMode, setPayMode] = useState<PosPayMode>('later')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryZone, setDeliveryZone] = useState('')
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([])
  const [dineInTableRef, setDineInTableRef] = useState('')
  const [deliveryDriverId, setDeliveryDriverId] = useState<string | null>(null)
  const [orderNote, setOrderNote] = useState('')
  const [suggestions, setSuggestions] = useState<CustomerListItem[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [driversOpen, setDriversOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Phone-first autocomplete
  useEffect(() => {
    if (!open) return
    const q = customerPhone.trim()
    if (q.length < 3 || customerId) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      setSuggestBusy(true)
      void searchCustomers(q, 8)
        .then(setSuggestions)
        .finally(() => setSuggestBusy(false))
    }, 220)
    return () => clearTimeout(timer)
  }, [customerPhone, customerId, open])

  function reset() {
    setOrderType('takeaway')
    setPayMode('later')
    setCustomerId(null)
    setCustomerName('')
    setCustomerPhone('')
    setDeliveryAddress('')
    setDeliveryZone('')
    setSavedAddresses([])
    setDineInTableRef('')
    setDeliveryDriverId(null)
    setOrderNote('')
    setSuggestions([])
    setSubmitting(false)
  }

  async function selectCustomer(c: CustomerListItem) {
    setCustomerId(c.id)
    setCustomerName(c.display_name)
    setCustomerPhone(c.primary_phone ?? customerPhone)
    setSuggestions([])
    try {
      const profile = await fetchCustomerProfile(c.id)
      setSavedAddresses(profile.addresses ?? [])
      const preferred =
        profile.addresses.find((a) => a.is_default) ?? profile.addresses[0]
      if (preferred) {
        setDeliveryAddress(preferred.address_line)
        setDeliveryZone(preferred.delivery_zone ?? '')
      }
      if (profile.display_name) setCustomerName(profile.display_name)
    } catch {
      setSavedAddresses([])
    }
  }

  function clearCustomerLink() {
    setCustomerId(null)
    setSavedAddresses([])
  }

  async function submit() {
    const phone = customerPhone.trim()
    const name = customerName.trim()
    const address = deliveryAddress.trim()
    const zone = deliveryZone.trim()

    // Customer/delivery details may be completed later on the sell screen.
    setSubmitting(true)
    try {
      let resolvedId = customerId
      let mode: CreateOrderResult['customerMode'] = 'walkin'

      if (phone && name) {
        resolvedId = await upsertCustomer({
          displayName: name,
          phone,
          address: orderType === 'delivery' ? address || null : null,
          deliveryZone: orderType === 'delivery' ? zone || null : null,
        })
        mode = customerId ? 'pick' : 'new'
      }

      onCreate({
        orderType,
        payMode: unpaidOnly ? 'later' : payMode,
        customerMode: mode,
        customerId: resolvedId,
        customerName: phone ? name : '',
        customerPhone: phone,
        deliveryAddress: address,
        deliveryZone: zone,
        dineInTableRef: dineInTableRef.trim(),
        deliveryDriverId: orderType === 'delivery' ? deliveryDriverId : null,
        orderNote: orderNote.trim(),
      })
      reset()
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  const showDeliveryFields = orderType === 'delivery'
  const showTableRef = orderType === 'dine_in'
  const showNameField = customerPhone.trim().length > 0 || orderType === 'delivery'

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset()
          onOpenChange(next)
        }}
      >
        <DialogContent className="flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
          <DialogHeader className="shrink-0 border-b border-[#eef2f7] px-5 py-4">
            <DialogTitle className="text-lg font-bold">
              {t.pos.create.title}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f8fafc] p-4 overscroll-contain">
            <section className="space-y-2">
              <p className="font-semibold text-[#0f172a]">
                {t.pos.create.orderType}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'dine_in' as const,
                      label: t.pos.create.types.dine_in,
                      icon: UtensilsCrossed,
                    },
                    {
                      id: 'takeaway' as const,
                      label: t.pos.create.types.takeaway,
                      icon: ShoppingBag,
                    },
                    {
                      id: 'delivery' as const,
                      label: t.pos.create.types.delivery,
                      icon: Bike,
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setOrderType(opt.id)}
                    className={cn(
                      'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-sm font-semibold transition-all',
                      orderType === opt.id
                        ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb] shadow-[0_4px_14px_rgba(59,130,246,0.18)]'
                        : 'border-[#e2e8f0] bg-white text-[#334155]',
                    )}
                  >
                    <opt.icon className="size-5" />
                    {opt.label}
                  </button>
                ))}
              </div>
              {orderType === 'dine_in' ? (
                <p className="text-xs text-[#64748b]">{t.pos.create.dineInHint}</p>
              ) : null}
            </section>

            {!unpaidOnly ? (
              <section className="space-y-2">
                <p className="font-semibold">{t.pos.create.payMode}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Choice
                    active={payMode === 'now'}
                    onClick={() => setPayMode('now')}
                    label={t.orders.hub.payNow}
                  />
                  <Choice
                    active={payMode === 'later'}
                    onClick={() => setPayMode('later')}
                    label={t.orders.hub.payLater}
                  />
                </div>
                <p className="text-xs text-[#64748b]">
                  {t.pos.create.deferCustomerHint}
                </p>
              </section>
            ) : null}

            {/* Phone-first customer — no pick/new buttons */}
            <section className="space-y-2">
              <p className="font-semibold">{t.pos.create.customer}</p>
              <Input
                className="h-11 rounded-2xl text-base"
                placeholder={t.customers.phoneFirst.placeholder}
                dir="ltr"
                value={customerPhone}
                onChange={(e) => {
                  clearCustomerLink()
                  setCustomerPhone(e.target.value)
                }}
              />
              {suggestBusy ? (
                <p className="text-xs text-[#64748b]">{t.common.loading}</p>
              ) : null}
              {suggestions.length > 0 ? (
                <ul className="max-h-28 space-y-1 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-1">
                  {suggestions.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="min-h-11 w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[#eff6ff]"
                        onClick={() => void selectCustomer(c)}
                      >
                        <span className="font-semibold">{c.display_name}</span>
                        {c.primary_phone ? (
                          <span className="text-[#64748b]" dir="ltr">
                            {' '}
                            · {c.primary_phone}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {customerId ? (
                <p className="text-sm font-semibold text-[#15803d]">
                  {customerName} · {t.customers.phoneFirst.matched}
                </p>
              ) : customerPhone.trim().length >= 3 &&
                !suggestBusy &&
                suggestions.length === 0 ? (
                <p className="text-xs text-[#64748b]">
                  {t.customers.phoneFirst.willCreate}
                </p>
              ) : null}

              {showNameField ? (
                <Input
                  className="h-11 rounded-2xl text-base"
                  placeholder={t.orders.hub.customerName}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              ) : (
                <p className="text-xs text-[#94a3b8]">
                  {t.customers.phoneFirst.walkinHint}
                </p>
              )}
            </section>

            {showTableRef ? (
              <section className="space-y-2">
                <Input
                  className="h-11 rounded-2xl text-base"
                  placeholder={t.pos.create.tableRef}
                  value={dineInTableRef}
                  onChange={(e) => setDineInTableRef(e.target.value)}
                />
              </section>
            ) : null}

            {showDeliveryFields ? (
              <section className="space-y-2">
                {savedAddresses.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {t.customers.phoneFirst.savedAddresses}
                    </p>
                    {savedAddresses.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={cn(
                          'min-h-10 w-full rounded-xl border px-3 py-2 text-start text-sm',
                          deliveryAddress === a.address_line
                            ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
                            : 'border-[#eef2f7] bg-white',
                        )}
                        onClick={() => {
                          setDeliveryAddress(a.address_line)
                          setDeliveryZone(a.delivery_zone ?? '')
                        }}
                      >
                        {a.address_line}
                        {a.delivery_zone ? ` · ${a.delivery_zone}` : ''}
                        {a.is_default ? (
                          <span className="ms-1 text-xs opacity-70">
                            ({t.customers.phoneFirst.defaultAddress})
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input
                  className="h-11 rounded-2xl text-base"
                  placeholder={
                    savedAddresses.length > 0
                      ? t.customers.phoneFirst.newAddress
                      : t.pos.create.address
                  }
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
                <Input
                  className="h-11 rounded-2xl text-base"
                  placeholder={t.pos.create.zone}
                  value={deliveryZone}
                  onChange={(e) => setDeliveryZone(e.target.value)}
                />
                <p className="font-semibold">{t.drivers.select}</p>
                {drivers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#fdba74] bg-[#fff7ed] p-3 text-center">
                    <p className="mb-2 text-sm font-semibold text-[#c2410c]">
                      {t.drivers.empty}
                    </p>
                    {canManageDrivers ? (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#f97316] px-4 text-sm font-semibold text-white"
                        onClick={() => setDriversOpen(true)}
                      >
                        <Plus className="size-4" />
                        {t.drivers.addNew}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <select
                    className="h-11 w-full rounded-2xl border border-[#e2e8f0] bg-white px-3 text-base"
                    value={deliveryDriverId ?? ''}
                    onChange={(e) =>
                      setDeliveryDriverId(e.target.value || null)
                    }
                  >
                    <option value="">{t.drivers.none}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.display_name}
                      </option>
                    ))}
                  </select>
                )}
                {canManageDrivers && drivers.length > 0 ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-[#2563eb]"
                    onClick={() => setDriversOpen(true)}
                  >
                    {t.drivers.manage}
                  </button>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-2">
              <p className="text-sm font-semibold text-[#0f172a]">
                {t.pos.create.note}
              </p>
              <Input
                className="h-11 rounded-2xl text-base"
                placeholder={t.pos.lineExtras.orderNotePlaceholder}
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
              />
              <p className="text-xs text-[#94a3b8]">{t.pos.create.noteHint}</p>
            </section>
          </div>

          <div className="shrink-0 space-y-1 border-t border-[#eef2f7] bg-white p-3">
            <div className="flex gap-2">
              <button
                type="button"
                className="min-h-12 flex-1 rounded-2xl text-sm font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                onClick={() => onOpenChange(false)}
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                disabled={submitting}
                className="min-h-12 flex-[2] rounded-2xl bg-[#22c55e] text-base font-semibold text-white shadow-[0_6px_18px_rgba(34,197,94,0.35)] hover:bg-[#16a34a] disabled:opacity-50"
                onClick={() => void submit()}
              >
                {t.pos.create.submit}
              </button>
            </div>
            <p className="text-center text-xs text-[#94a3b8]">
              {t.pos.create.submitHint}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <DeliveryDriversDialog open={driversOpen} onOpenChange={setDriversOpen} />
    </>
  )
}

function Choice({
  active,
  onClick,
  label,
  className,
}: {
  active: boolean
  onClick: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-14 items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition-all',
        active
          ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
          : 'border-[#e2e8f0] bg-white text-[#334155]',
        className,
      )}
    >
      {label}
    </button>
  )
}
