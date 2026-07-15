import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Minus, Plus, Search, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { ModifierPickerDialog } from '@/features/pos/components/ModifierPickerDialog'
import { LineExtrasDialog } from '@/features/pos/components/LineExtrasDialog'
import { OpenPriceDialog } from '@/features/pos/components/OpenPriceDialog'
import { PaymentDialog } from '@/features/pos/components/PaymentDialog'
import { PayLaterCheckoutDialog } from '@/features/pos/components/PayLaterCheckoutDialog'
import { usePosCart } from '@/features/pos/hooks/usePosCart'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { usePosContext, usePosMenu } from '@/features/pos/hooks/usePosQueries'
import {
  fetchCustomerProfile,
  searchCustomers,
  upsertCustomer,
} from '@/features/customers/api/customers.api'
import type {
  CustomerAddress,
  CustomerListItem,
} from '@/features/customers/types'
import {
  draftHasWork,
  orderMetaFromDraft,
  shouldIgnoreSellDismiss,
  type PosDraft,
  type PosPayMode,
} from '@/features/pos/state/pos-draft'
import type { CartLine, PosMenuItem } from '@/features/pos/types'
import {
  freeSauceMenuItems,
  isFreeSauceMenuItem,
  noteDisplayLines,
  noteHasSauce,
  toggleSauceInNote,
} from '@/features/pos/utils/line-note'
import { formatMoney } from '@/features/treasury/utils/format'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  draft: PosDraft | null
  onOpenChange: (open: boolean) => void
  onHold: (draft: PosDraft) => void
  onCompleted: () => void
}

function itemMatchesQuery(item: PosMenuItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.sku?.toLowerCase().includes(needle) ?? false)
  )
}

function typeLabel(type: PosDraft['orderType']) {
  if (type === 'dine_in') return t.pos.create.types.dine_in
  if (type === 'delivery') return t.pos.create.types.delivery
  return t.pos.create.types.takeaway
}

export function SellSessionDialog({
  open,
  draft,
  onOpenChange,
  onHold,
  onCompleted,
}: Props) {
  const queryClient = useQueryClient()
  const menuQuery = usePosMenu()
  const contextQuery = usePosContext()
  const cart = usePosCart()
  const menu = menuQuery.data
  const ctx = contextQuery.data
  const hasOpenShift = Boolean(ctx?.open_shift)
  const paymentMethods = ctx?.payment_methods ?? []

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | 'favorites'>('favorites')
  const [modifierItem, setModifierItem] = useState<PosMenuItem | null>(null)
  const [openPriceItem, setOpenPriceItem] = useState<PosMenuItem | null>(null)
  const [extrasLine, setExtrasLine] = useState<CartLine | null>(null)
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [orderNote, setOrderNote] = useState('')
  const [payMode, setPayMode] = useState<PosPayMode>('later')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryZone, setDeliveryZone] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([])
  const [suggestions, setSuggestions] = useState<CustomerListItem[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [payLaterOpen, setPayLaterOpen] = useState(false)
  const [hydratedId, setHydratedId] = useState<string | null>(null)
  const closingRef = useRef(false)

  const replaceLines = cart.replaceLines

  useEffect(() => {
    if (!open || !draft) return
    if (hydratedId === draft.id) return
    replaceLines(draft.lines)
    setOrderNote(draft.orderNote ?? '')
    setPayMode(draft.payMode)
    setCustomerName(draft.customerName ?? '')
    setCustomerPhone(draft.customerPhone ?? '')
    setDeliveryAddress(draft.deliveryAddress ?? '')
    setDeliveryZone(draft.deliveryZone ?? '')
    setCustomerId(draft.customerId)
    setSavedAddresses([])
    setSuggestions([])
    setSelectedLineKey(null)
    setHydratedId(draft.id)
    setSearch('')
    setCategory('favorites')
    closingRef.current = false
  }, [open, draft, hydratedId, replaceLines])

  useEffect(() => {
    if (!open) setHydratedId(null)
  }, [open])

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
      if (preferred && draft?.orderType === 'delivery') {
        setDeliveryAddress(preferred.address_line)
        setDeliveryZone(preferred.delivery_zone ?? '')
      }
      if (profile.display_name) setCustomerName(profile.display_name)
    } catch {
      setSavedAddresses([])
    }
  }

  // Keep extras dialog line in sync with cart updates (live sauce toggles).
  const extrasLive = useMemo(() => {
    if (!extrasLine) return null
    return cart.lines.find((l) => l.key === extrasLine.key) ?? extrasLine
  }, [extrasLine, cart.lines])

  const visibleItems = useMemo(() => {
    if (!menu) return []
    if (search.trim()) {
      const all: PosMenuItem[] = [
        ...menu.favorites,
        ...menu.categories.flatMap((c) => c.items),
      ]
      const seen = new Set<string>()
      return all.filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return itemMatchesQuery(item, search)
      })
    }
    if (category === 'favorites') return menu.favorites
    return menu.categories.find((c) => c.id === category)?.items ?? []
  }, [menu, search, category])

  function applySauceToLine(lineKey: string, sauceName: string) {
    const line = cart.lines.find((l) => l.key === lineKey)
    if (!line) return
    const sauceNames = freeSauceMenuItems(menu?.categories).map((s) => s.name)
    const next = toggleSauceInNote(line.note, sauceName, sauceNames)
    const added = !noteHasSauce(line.note, sauceName, sauceNames)
    cart.updateNote(lineKey, next)
    toast.message(
      added
        ? t.pos.sell.sauceApplied(sauceName, line.name)
        : t.pos.sell.sauceRemoved(sauceName, line.name),
    )
  }

  function handleItemTap(item: PosMenuItem) {
    if (isFreeSauceMenuItem(item, menu?.categories)) {
      const targetKey =
        selectedLineKey && cart.lines.some((l) => l.key === selectedLineKey)
          ? selectedLineKey
          : cart.lines[cart.lines.length - 1]?.key
      if (!targetKey) {
        toast.error(t.pos.sell.needItemFirst)
        return
      }
      applySauceToLine(targetKey, item.name)
      return
    }
    if (item.is_open_price) {
      setOpenPriceItem(item)
      return
    }
    if (item.accepts_modifiers && item.modifier_groups.length > 0) {
      setModifierItem(item)
      return
    }
    const key = cart.addItem(item)
    if (key) setSelectedLineKey(key)
  }

  function liveDraft(): PosDraft {
    return {
      ...draft!,
      payMode,
      customerId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      deliveryZone: deliveryZone.trim(),
      orderNote: orderNote.trim(),
      lines: cart.lines,
    }
  }

  function snapshotDraft(): PosDraft | null {
    if (!draft) return null
    return liveDraft()
  }

  const blockingOverlay = shouldIgnoreSellDismiss({
    paymentOpen,
    payLaterOpen,
    hasModifierPicker: modifierItem !== null,
    hasOpenPrice: openPriceItem !== null,
    hasLineExtras: extrasLine !== null,
  })

  function finishClose() {
    closingRef.current = true
    onOpenChange(false)
  }

  function holdAndClose(message?: string) {
    if (closingRef.current) return
    if (blockingOverlay) return
    closingRef.current = true
    const snap = snapshotDraft()
    if (snap && draftHasWork(snap)) {
      onHold({
        ...snap,
        heldAt: new Date().toISOString(),
      })
      cart.clear()
      toast.message(message ?? t.pos.hold.heldOutside)
    }
    onOpenChange(false)
  }

  function handleDialogOpenChange(next: boolean) {
    if (next) {
      onOpenChange(true)
      return
    }
    if (blockingOverlay) return
    holdAndClose()
  }

  function deliveryReady(): boolean {
    if (draft?.orderType !== 'delivery') return true
    return Boolean(
      customerName.trim() && customerPhone.trim() && deliveryAddress.trim(),
    )
  }

  async function resolveCustomerId(): Promise<string | null> {
    const phone = customerPhone.trim()
    const name = customerName.trim()
    if (!phone || !name) return null
    const id = await upsertCustomer({
      displayName: name,
      phone,
      address:
        draft?.orderType === 'delivery' ? deliveryAddress.trim() || null : null,
      deliveryZone:
        draft?.orderType === 'delivery' ? deliveryZone.trim() || null : null,
    })
    setCustomerId(id)
    return id
  }

  function handlePrimaryAction() {
    if (!draft || cart.lines.length === 0) return
    if (!deliveryReady()) {
      toast.error(t.pos.sell.deliveryIncomplete)
      return
    }

    if (payMode === 'now') {
      void (async () => {
        try {
          await resolveCustomerId()
          setPaymentOpen(true)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t.orders.errors.generic)
        }
      })()
      return
    }

    void (async () => {
      try {
        await resolveCustomerId()
        setPayLaterOpen(true)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t.orders.errors.generic)
      }
    })()
  }

  if (!draft) return null

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="flex h-[94dvh] max-h-[94dvh] w-[min(96vw,72rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-[0_20px_50px_rgba(15,23,42,0.18)]"
          onPointerDownOutside={(e) => {
            // Nested portals (payment / modifiers) are "outside" this content —
            // never park the order while those are open.
            if (blockingOverlay) {
              e.preventDefault()
              return
            }
            e.preventDefault()
            holdAndClose()
          }}
          onInteractOutside={(e) => {
            if (blockingOverlay) {
              e.preventDefault()
              return
            }
            e.preventDefault()
            holdAndClose()
          }}
          onEscapeKeyDown={(e) => {
            if (blockingOverlay) return
            e.preventDefault()
            holdAndClose()
          }}
        >
          <DialogHeader className="shrink-0 border-b border-[#eef2f7] px-5 py-2.5 pe-12">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>
                {t.pos.sell.sessionTitle} · {draft.localRef}
              </span>
              <Badge className="border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]">
                {typeLabel(draft.orderType)}
              </Badge>
              <Badge
                className={
                  payMode === 'now'
                    ? 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
                    : 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
                }
              >
                {payMode === 'now'
                  ? t.orders.hub.payNow
                  : t.orders.hub.payLater}
              </Badge>
              {customerName.trim() ? (
                <Badge variant="secondary">{customerName.trim()}</Badge>
              ) : (
                <Badge variant="secondary">{t.pos.create.walkin}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {!hasOpenShift ? (
            <p className="shrink-0 bg-[#fffbeb] px-5 py-2 text-sm text-[#92400e]">
              {t.pos.shift.closed}
            </p>
          ) : null}

          {/* Customer + pay on top — frees cart column */}
          <div className="relative z-20 shrink-0 space-y-2 border-b border-[#eef2f7] bg-white px-4 py-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-[#64748b]">
                  {t.pos.sell.payModeSection}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className={cn(
                      'min-h-10 rounded-xl border px-3 text-xs font-semibold',
                      payMode === 'now'
                        ? 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
                        : 'border-[#e2e8f0] bg-white text-[#64748b]',
                    )}
                    onClick={() => setPayMode('now')}
                  >
                    {t.orders.hub.payNow}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'min-h-10 rounded-xl border px-3 text-xs font-semibold',
                      payMode === 'later'
                        ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
                        : 'border-[#e2e8f0] bg-white text-[#64748b]',
                    )}
                    onClick={() => setPayMode('later')}
                  >
                    {t.orders.hub.payLater}
                  </button>
                </div>
              </div>

              <label className="min-w-[9.5rem] flex-1 space-y-1 sm:max-w-[14rem]">
                <span className="text-[11px] font-semibold text-[#64748b]">
                  {t.pos.sell.customerSection}
                </span>
                <Input
                  className="h-10 rounded-xl text-sm"
                  placeholder={t.customers.phoneFirst.placeholder}
                  dir="ltr"
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerId(null)
                    setSavedAddresses([])
                    setCustomerPhone(e.target.value)
                  }}
                />
              </label>

              <label className="min-w-[8rem] flex-1 space-y-1 sm:max-w-[12rem]">
                <span className="text-[11px] font-semibold text-[#64748b]">
                  {t.orders.hub.customerName}
                </span>
                <Input
                  className="h-10 rounded-xl text-sm"
                  placeholder={t.orders.hub.customerName}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </label>

              {draft.orderType === 'delivery' ? (
                <>
                  <label className="min-w-[10rem] flex-[1.4] space-y-1">
                    <span className="text-[11px] font-semibold text-[#64748b]">
                      {t.pos.create.address}
                    </span>
                    <Input
                      className="h-10 rounded-xl text-sm"
                      placeholder={t.pos.create.address}
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                    />
                  </label>
                  <label className="min-w-[6rem] flex-1 space-y-1 sm:max-w-[9rem]">
                    <span className="text-[11px] font-semibold text-[#64748b]">
                      {t.pos.create.zone}
                    </span>
                    <Input
                      className="h-10 rounded-xl text-sm"
                      placeholder={t.pos.create.zone}
                      value={deliveryZone}
                      onChange={(e) => setDeliveryZone(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>

            {suggestions.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-1 shadow-md">
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="min-h-10 w-full rounded-lg px-2.5 py-2 text-start text-sm hover:bg-[#eff6ff]"
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

            {suggestBusy ? (
              <p className="text-[11px] text-[#64748b]">
                {t.pos.sell.customerLookup}
              </p>
            ) : null}
            {customerId ? (
              <p className="text-xs font-semibold text-[#15803d]">
                {customerName} · {t.customers.phoneFirst.matched}
              </p>
            ) : customerPhone.trim().length >= 3 &&
              !suggestBusy &&
              suggestions.length === 0 ? (
              <p className="text-[11px] text-[#64748b]">
                {t.customers.phoneFirst.willCreate}
              </p>
            ) : null}

            {draft.orderType === 'delivery' && savedAddresses.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {savedAddresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1.5 text-xs font-medium hover:border-[#93c5fd]"
                    onClick={() => {
                      setDeliveryAddress(a.address_line)
                      setDeliveryZone(a.delivery_zone ?? '')
                    }}
                  >
                    {a.label ? `${a.label}: ` : ''}
                    {a.address_line}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid min-h-0 flex-1 gap-3 overflow-hidden bg-[#f8fafc] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,34%)]">
            <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-2xl border border-white/80 bg-white p-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <div className="relative shrink-0">
                <Search className="absolute top-1/2 right-3 size-5 -translate-y-1/2 text-[#94a3b8]" />
                <Input
                  className="h-11 rounded-2xl border-[#e2e8f0] bg-[#f8fafc] pr-10"
                  placeholder={t.pos.search.placeholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {!search.trim() ? (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <CatBtn
                    active={category === 'favorites'}
                    onClick={() => setCategory('favorites')}
                    label={t.pos.tabs.favorites}
                  />
                  {menu?.categories.map((cat) => (
                    <CatBtn
                      key={cat.id}
                      active={category === cat.id}
                      onClick={() => setCategory(cat.id)}
                      label={cat.name}
                    />
                  ))}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {visibleItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleItemTap(item)}
                      className="min-h-[76px] rounded-2xl border border-[#eef2f7] bg-[#f8fafc] p-2.5 text-right shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-all hover:border-[#93c5fd] hover:bg-white active:scale-[0.98]"
                    >
                      <p className="line-clamp-2 text-sm font-semibold">
                        {item.name}
                      </p>
                      <p
                        className="mt-1 text-xs font-medium text-[#3b82f6]"
                        dir="ltr"
                      >
                        {formatMoney(item.base_price)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <aside className="flex min-h-0 flex-col rounded-2xl border border-white/80 bg-white p-3 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
              <div className="mb-1.5 flex shrink-0 items-center justify-between">
                <h3 className="font-bold">{t.pos.cart.title}</h3>
                {cart.lines.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[#dc2626]"
                    onClick={cart.clear}
                  >
                    {t.pos.cart.clear}
                  </button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {cart.lines.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[#64748b]">
                    {t.pos.cart.empty}
                  </p>
                ) : (
                  cart.lines.map((line) => {
                    const selected = selectedLineKey === line.key
                    return (
                      <div
                        key={line.key}
                        className={cn(
                          'rounded-2xl border p-2.5',
                          selected
                            ? 'border-[#86efac] bg-[#f0fdf4]'
                            : 'border-[#eef2f7] bg-[#f8fafc]',
                        )}
                      >
                        <div className="flex justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-right"
                            onClick={() => setSelectedLineKey(line.key)}
                          >
                            <p className="font-medium">{line.name}</p>
                            {selected ? (
                              <p className="text-[11px] font-semibold text-[#15803d]">
                                {t.pos.lineExtras.selected}
                              </p>
                            ) : null}
                            {line.modifierSummary ? (
                              <p className="text-xs text-[#64748b]">
                                {line.modifierSummary}
                              </p>
                            ) : null}
                            {line.note
                              ? noteDisplayLines(line.note).map((row) => (
                                  <p
                                    key={row}
                                    className="mt-0.5 text-xs font-medium text-[#15803d]"
                                  >
                                    {row}
                                  </p>
                                ))
                              : null}
                          </button>
                          <div className="flex flex-col items-end gap-1">
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-[#2563eb]"
                              onClick={() => {
                                setSelectedLineKey(line.key)
                                setExtrasLine(line)
                              }}
                            >
                              {t.pos.lineExtras.edit}
                            </button>
                            <button
                              type="button"
                              className="text-[#ef4444]"
                              onClick={() => cart.removeLine(line.key)}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <QtyBtn
                              onClick={() =>
                                cart.updateQuantity(line.key, line.quantity - 1)
                              }
                            >
                              <Minus className="size-4" />
                            </QtyBtn>
                            <span
                              className="w-8 text-center font-semibold"
                              dir="ltr"
                            >
                              {line.quantity}
                            </span>
                            <QtyBtn
                              onClick={() =>
                                cart.updateQuantity(line.key, line.quantity + 1)
                              }
                            >
                              <Plus className="size-4" />
                            </QtyBtn>
                          </div>
                          <span className="font-bold" dir="ltr">
                            {formatMoney(line.unitPrice * line.quantity)}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="mt-2 shrink-0 space-y-2 border-t border-[#eef2f7] pt-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-[#334155]">
                    {t.pos.lineExtras.orderNote}
                  </span>
                  <Input
                    className="h-10 rounded-2xl border-[#e2e8f0] bg-[#f8fafc] text-sm"
                    placeholder={t.pos.lineExtras.orderNotePlaceholder}
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                  />
                </label>
                <div className="flex justify-between text-sm text-[#64748b]">
                  <span>{t.pos.cart.subtotal}</span>
                  <strong className="text-[#0f172a]" dir="ltr">
                    {formatMoney(cart.subtotal)}
                  </strong>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-[#dcfce7] px-3 py-2.5 text-base font-bold text-[#15803d]">
                  <span>{t.orders.money.remaining}</span>
                  <span dir="ltr">{formatMoney(cart.subtotal)}</span>
                </div>
              </div>
            </aside>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 border-t border-[#eef2f7] bg-white p-3">
            <button
              type="button"
              className="min-h-12 rounded-2xl border border-[#e2e8f0] px-4 text-sm font-semibold disabled:opacity-40"
              disabled={!draftHasWork(liveDraft()) || blockingOverlay}
              onClick={() => {
                holdAndClose(t.pos.hold.held)
              }}
            >
              {t.pos.hold.action}
            </button>
            <button
              type="button"
              className="min-h-12 rounded-2xl px-4 text-sm font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
              onClick={() => holdAndClose()}
            >
              {t.orders.hub.backToPos}
            </button>
            <button
              type="button"
              className="min-h-14 min-w-[180px] flex-1 rounded-2xl bg-[#22c55e] text-base font-semibold text-white shadow-[0_6px_18px_rgba(34,197,94,0.35)] disabled:opacity-40"
              disabled={
                !hasOpenShift || cart.lines.length === 0
              }
              onClick={handlePrimaryAction}
            >
              {payMode === 'now'
                ? t.pos.payment.confirmWithAmount(formatMoney(cart.subtotal))
                : `${t.orders.hub.payLater} · ${formatMoney(cart.subtotal)}`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ModifierPickerDialog
        item={modifierItem}
        open={modifierItem !== null}
        onOpenChange={(o) => !o && setModifierItem(null)}
        onConfirm={(ids) => {
          if (modifierItem) {
            const key = cart.addItem(modifierItem, { modifierOptionIds: ids })
            if (key) setSelectedLineKey(key)
          }
          setModifierItem(null)
        }}
      />
      <LineExtrasDialog
        open={extrasLive !== null}
        onOpenChange={(o) => !o && setExtrasLine(null)}
        lineName={extrasLive?.name ?? ''}
        initialNote={extrasLive?.note}
        categories={menu?.categories}
        onToggleSauce={(sauceName) => {
          if (!extrasLive) return
          applySauceToLine(extrasLive.key, sauceName)
        }}
        onSaveNote={(note) => {
          if (extrasLive) cart.updateNote(extrasLive.key, note)
          setExtrasLine(null)
        }}
      />
      <OpenPriceDialog
        item={openPriceItem}
        open={openPriceItem !== null}
        onOpenChange={(o) => !o && setOpenPriceItem(null)}
        onConfirm={(price) => {
          if (openPriceItem) {
            const key = cart.addItem(openPriceItem, { openPrice: price })
            if (key) setSelectedLineKey(key)
          }
          setOpenPriceItem(null)
        }}
      />
      {ctx && draft ? (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          lines={cart.lines}
          subtotal={cart.subtotal}
          canDiscount={ctx.can_discount}
          discountPermissionsConfig={ctx.discount_permissions}
          paymentMethods={paymentMethods}
          orderMeta={orderMetaFromDraft(liveDraft())}
          onSuccess={(change) => {
            cart.clear()
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
            void queryClient.invalidateQueries({ queryKey: ['orders'] })
            if (change > 0) {
              toast.message(`${t.pos.payment.change}: ${formatMoney(change)}`)
            }
            onCompleted()
            finishClose()
          }}
        />
      ) : null}
      {ctx && draft ? (
        <PayLaterCheckoutDialog
          open={payLaterOpen}
          onOpenChange={setPayLaterOpen}
          lines={cart.lines}
          subtotal={cart.subtotal}
          canDiscount={ctx.can_discount}
          discountPermissionsConfig={ctx.discount_permissions}
          orderMeta={orderMetaFromDraft(liveDraft())}
          onSuccess={(reference) => {
            cart.clear()
            void queryClient.invalidateQueries({ queryKey: posKeys.context() })
            void queryClient.invalidateQueries({ queryKey: ['orders'] })
            toast.success(t.pos.payment.success(reference))
            onCompleted()
            finishClose()
          }}
        />
      ) : null}
    </>
  )
}

function CatBtn({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
        active
          ? 'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb]'
          : 'border-[#e2e8f0] bg-white text-[#334155]',
      )}
    >
      {label}
    </button>
  )
}

function QtyBtn({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-10 items-center justify-center rounded-xl border border-[#e2e8f0] bg-white"
    >
      {children}
    </button>
  )
}
