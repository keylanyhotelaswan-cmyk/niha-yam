import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Minus, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Badge } from '@/shared/components/ui/badge'
import { ModifierPickerDialog } from '@/features/pos/components/ModifierPickerDialog'
import { LineExtrasDialog } from '@/features/pos/components/LineExtrasDialog'
import { OpenPriceDialog } from '@/features/pos/components/OpenPriceDialog'
import { OrderMoneySummary } from '@/features/orders/components/OrderMoneySummary'
import { usePosCart } from '@/features/pos/hooks/usePosCart'
import { sortPaymentMethods } from '@/features/pos/utils/paymentMethods'
import { usePosContext, usePosMenu } from '@/features/pos/hooks/usePosQueries'
import { editPendingOrder } from '@/features/orders/api/orders.api'
import {
  fetchCustomerProfile,
  searchCustomers,
} from '@/features/customers/api/customers.api'
import type { CustomerListItem } from '@/features/customers/types'
import { formatMoney } from '@/features/treasury/utils/format'
import { supabase } from '@/lib/supabase/client'
import type { OrderDetail, OrderMoney } from '@/features/orders/types'
import type { CartLine, PosMenuItem, TenderInput } from '@/features/pos/types'
import {
  freeSauceMenuItems,
  isFreeSauceMenuItem,
  noteDisplayLines,
  noteHasSauce,
  toggleSauceInNote,
} from '@/features/pos/utils/line-note'
import { t } from '@/shared/i18n'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: OrderDetail
  onSaved: () => void
}

type TenderRow = { methodId: string; amount: string }

function itemMatchesQuery(item: PosMenuItem, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.sku?.toLowerCase().includes(needle) ?? false)
  )
}

function previewMoney(
  subtotal: number,
  discountAmount: number,
  collected: number,
): OrderMoney {
  const net = Math.max(0, subtotal - Math.max(0, discountAmount))
  const remaining = Math.max(net - collected, 0)
  const payment_status =
    collected <= 0 ? 'unpaid' : collected >= net ? 'paid' : 'partial'
  return {
    order_total: net,
    collected_amount: collected,
    remaining_amount: remaining,
    payment_status,
    pending_collections_count: 0,
    approved_collections_count: 0,
    has_approved_collection: false,
    over_collected_amount: Math.max(collected - net, 0),
  }
}

type ModifierRow = {
  order_item_id: string
  modifier_option_id: string | null
}

async function loadModifierIds(
  orderItemIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (orderItemIds.length === 0) return map
  // Generated Database types may omit this table; use untyped client call.
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{ data: ModifierRow[] | null; error: unknown }>
      }
    }
  }
  const { data } = await client
    .from('order_item_modifiers')
    .select('order_item_id, modifier_option_id')
    .in('order_item_id', orderItemIds)
  for (const row of data ?? []) {
    const opt = row.modifier_option_id
    if (!opt) continue
    const list = map.get(row.order_item_id) ?? []
    list.push(opt)
    map.set(row.order_item_id, list)
  }
  return map
}

export function OrderEditDialog({ open, onOpenChange, detail, onSaved }: Props) {
  const queryClient = useQueryClient()
  const menuQuery = usePosMenu()
  const contextQuery = usePosContext()
  const cart = usePosCart()
  const paymentMethods = sortPaymentMethods(contextQuery.data?.payment_methods ?? [])

  const [search, setSearch] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'favorites'>(
    'favorites',
  )
  const [modifierItem, setModifierItem] = useState<PosMenuItem | null>(null)
  const [openPriceItem, setOpenPriceItem] = useState<PosMenuItem | null>(null)
  const [extrasLine, setExtrasLine] = useState<CartLine | null>(null)
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<CustomerListItem[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [orderNote, setOrderNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [replaceTender, setReplaceTender] = useState(false)
  const [tenderRows, setTenderRows] = useState<TenderRow[]>([])

  const menu = menuQuery.data
  const canEdit =
    detail.order.can_free_edit !== false &&
    !detail.money?.has_approved_collection

  // Live preview: if replacing tenders, collected becomes new tender sum; else keep locked collected
  const lockedCollected = detail.money?.collected_amount ?? 0
  const tenderSum = tenderRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const previewCollected = replaceTender ? tenderSum : lockedCollected
  const liveMoney = previewMoney(
    cart.subtotal,
    Number(detail.order.discount_amount ?? 0),
    previewCollected,
  )

  useEffect(() => {
    if (!open || !menu) return
    let cancelled = false

    void (async () => {
      const modMap = await loadModifierIds(detail.items.map((i) => i.id))
      if (cancelled) return

      const allItems = [
        ...menu.favorites,
        ...menu.categories.flatMap((c) => c.items),
      ]

      const lines: CartLine[] = detail.items.map((line) => {
        const menuItem = allItems.find((i) => i.id === line.menu_item_id)
        const modifierOptionIds = modMap.get(line.id) ?? []
        const names: string[] = []
        if (menuItem) {
          for (const g of menuItem.modifier_groups) {
            for (const optId of modifierOptionIds) {
              const opt = g.options.find((o) => o.id === optId)
              if (opt) names.push(opt.name)
            }
          }
        }
        return {
          key: crypto.randomUUID(),
          menuItemId: line.menu_item_id ?? menuItem?.id ?? '',
          name: line.name,
          sku: menuItem?.sku ?? null,
          unitPrice: line.unit_price,
          quantity: line.quantity,
          modifierOptionIds,
          modifierSummary: names.join('، '),
          openPrice: menuItem?.is_open_price ? line.unit_price : undefined,
          note: line.line_note ?? undefined,
          isOpenPrice: menuItem?.is_open_price ?? false,
        }
      })
      cart.replaceLines(lines)
      setCustomerName(detail.order.delivery_name ?? '')
      setCustomerPhone(detail.order.delivery_phone ?? '')
      setCustomerId(detail.order.customer_id ?? null)
      setSuggestions([])
      setOrderNote(detail.order.order_note ?? '')
      setReplaceTender(false)
      const cash = paymentMethods.find((p) => p.code === 'cash') ?? paymentMethods[0]
      setTenderRows(
        cash
          ? [{ methodId: cash.id, amount: String(detail.money?.order_total ?? detail.order.total) }]
          : [],
      )
      setHydrated(true)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per open+menu
  }, [open, menu, detail.order.id])

  useEffect(() => {
    if (!open) setHydrated(false)
  }, [open])

  useEffect(() => {
    if (!open || !canEdit) return
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
  }, [customerPhone, customerId, open, canEdit])

  async function selectCustomer(c: CustomerListItem) {
    setCustomerId(c.id)
    setCustomerName(c.display_name)
    setCustomerPhone(c.primary_phone ?? customerPhone)
    setSuggestions([])
    try {
      const profile = await fetchCustomerProfile(c.id)
      if (profile.display_name) setCustomerName(profile.display_name)
      const phone =
        profile.phones.find((p) => p.is_primary)?.phone_raw ??
        profile.phones[0]?.phone_raw
      if (phone) setCustomerPhone(phone)
    } catch {
      /* keep typed values */
    }
  }

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
    if (activeCategoryId === 'favorites') return menu.favorites
    return menu.categories.find((c) => c.id === activeCategoryId)?.items ?? []
  }, [menu, search, activeCategoryId])

  function handleItemTap(item: PosMenuItem) {
    if (!canEdit) return
    if (isFreeSauceMenuItem(item, menu?.categories)) {
      const targetKey =
        selectedLineKey && cart.lines.some((l) => l.key === selectedLineKey)
          ? selectedLineKey
          : cart.lines[cart.lines.length - 1]?.key
      if (!targetKey) {
        toast.error(t.pos.sell.needItemFirst)
        return
      }
      const live = cart.lines.find((l) => l.key === targetKey)
      if (!live) return
      const sauceNames = freeSauceMenuItems(menu?.categories).map((s) => s.name)
      const added = !noteHasSauce(live.note, item.name, sauceNames)
      cart.updateNote(
        targetKey,
        toggleSauceInNote(live.note, item.name, sauceNames),
      )
      toast.message(
        added
          ? t.pos.sell.sauceApplied(item.name, live.name)
          : t.pos.sell.sauceRemoved(item.name, live.name),
      )
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

  async function handleSave() {
    if (!canEdit) return
    if (cart.lines.length === 0) {
      toast.error(t.orders.errors.EMPTY_CART)
      return
    }

    let tenders: TenderInput[] | null = null
    if (replaceTender) {
      tenders = tenderRows
        .map((r) => ({
          payment_method_id: r.methodId,
          amount: Math.round((Number(r.amount) || 0) * 100) / 100,
        }))
        .filter((r) => r.amount > 0)
      if (tenders.length === 0) {
        toast.error(t.pos.errors.INVALID_TENDER)
        return
      }
    }

    setSaving(true)
    try {
      await editPendingOrder({
        orderId: detail.order.id,
        items: cart.lines.map((line) => ({
          menu_item_id: line.menuItemId,
          quantity: line.quantity,
          modifier_option_ids: line.modifierOptionIds,
          open_price: line.openPrice,
          note: line.note,
        })),
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        orderNote: orderNote.trim(),
        tenders,
      })
      toast.success(t.orders.hub.editSaved)
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.orders.errors.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[92dvh] max-w-5xl flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
        <DialogHeader className="shrink-0 border-b border-[#eef2f7] px-4 py-3">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {t.orders.hub.editOrder}
            <span className="text-muted-foreground font-normal" dir="ltr">
              {detail.order.reference}
            </span>
            {!canEdit ? (
              <Badge variant="destructive">{t.orders.hub.freeEditBlocked}</Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {!canEdit ? (
          <div className="p-4">
            <p className="text-destructive text-sm">{t.orders.hub.freeEditBlocked}</p>
            <p className="text-muted-foreground mt-2 text-sm">
              {t.orders.hub.useAmendPath}
            </p>
            <Button
              type="button"
              className="mt-4"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t.common.close}
            </Button>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_340px]">
            <section className="min-h-0 space-y-3 overflow-y-auto p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Input
                    placeholder={t.customers.phoneFirst.placeholder}
                    value={customerPhone}
                    onChange={(e) => {
                      setCustomerId(null)
                      setCustomerPhone(e.target.value)
                    }}
                    dir="ltr"
                  />
                  {suggestBusy ? (
                    <p className="text-xs text-[#64748b]">{t.common.loading}</p>
                  ) : null}
                  {suggestions.length > 0 ? (
                    <ul className="max-h-44 space-y-1 overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-1">
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
                    <p className="text-xs font-semibold text-[#15803d]">
                      {customerName} · {t.customers.phoneFirst.matched}
                    </p>
                  ) : customerPhone.trim().length >= 3 &&
                    !suggestBusy &&
                    suggestions.length === 0 ? (
                    <p className="text-xs text-[#64748b]">
                      {t.customers.phoneFirst.willCreate}
                    </p>
                  ) : null}
                </div>
                <Input
                  placeholder={t.orders.hub.customerName}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <Input
                placeholder={t.pos.search.placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {!search.trim() ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      activeCategoryId === 'favorites' ? 'default' : 'outline'
                    }
                    onClick={() => setActiveCategoryId('favorites')}
                  >
                    {t.pos.tabs.favorites}
                  </Button>
                  {menu?.categories.map((cat) => (
                    <Button
                      key={cat.id}
                      type="button"
                      size="sm"
                      variant={
                        activeCategoryId === cat.id ? 'default' : 'outline'
                      }
                      onClick={() => setActiveCategoryId(cat.id)}
                    >
                      {cat.name}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleItems.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-[64px] flex-col items-start gap-1 px-3 py-2 text-right whitespace-normal"
                    onClick={() => handleItemTap(item)}
                  >
                    <span className="line-clamp-2 text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="text-muted-foreground text-xs" dir="ltr">
                      {formatMoney(item.base_price)}
                    </span>
                  </Button>
                ))}
              </div>
            </section>

            <aside className="flex min-h-0 flex-col border-t lg:border-t-0 lg:border-s">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                <p className="font-medium">{t.pos.cart.title}</p>
                {!hydrated ? (
                  <p className="text-muted-foreground text-sm">
                    {t.common.loading}
                  </p>
                ) : cart.lines.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t.pos.cart.empty}
                  </p>
                ) : (
                  cart.lines.map((line) => (
                    <div
                      key={line.key}
                      className={`rounded-md border p-2 text-sm ${
                        selectedLineKey === line.key
                          ? 'border-green-400 bg-green-50'
                          : ''
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-right"
                          onClick={() => setSelectedLineKey(line.key)}
                        >
                          <span className="font-medium">{line.name}</span>
                          {selectedLineKey === line.key ? (
                            <p className="text-xs font-semibold text-[#15803d]">
                              {t.pos.lineExtras.selected}
                            </p>
                          ) : null}
                          {line.modifierSummary ? (
                            <p className="text-muted-foreground text-xs">
                              {line.modifierSummary}
                            </p>
                          ) : null}
                          {line.note
                            ? noteDisplayLines(line.note).map((row) => (
                                <p
                                  key={row}
                                  className="text-xs font-medium text-[#15803d]"
                                >
                                  {row}
                                </p>
                              ))
                            : null}
                        </button>
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setSelectedLineKey(line.key)
                              setExtrasLine(line)
                            }}
                          >
                            {t.pos.lineExtras.edit}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => cart.removeLine(line.key)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="size-7"
                            onClick={() =>
                              cart.updateQuantity(line.key, line.quantity - 1)
                            }
                          >
                            <Minus className="size-3.5" />
                          </Button>
                          <span className="w-6 text-center" dir="ltr">
                            {line.quantity}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="size-7"
                            onClick={() =>
                              cart.updateQuantity(line.key, line.quantity + 1)
                            }
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </div>
                        <span>
                          {formatMoney(line.unitPrice * line.quantity)}
                        </span>
                      </div>
                    </div>
                  ))
                )}

                <div className="space-y-1 rounded-md border p-2">
                  <Label className="text-xs">{t.pos.lineExtras.orderNote}</Label>
                  <Input
                    placeholder={t.pos.lineExtras.orderNotePlaceholder}
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    {t.pos.lineExtras.orderNoteHint}
                  </p>
                </div>

                <div className="space-y-2 rounded-md border p-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={replaceTender}
                      onChange={(e) => setReplaceTender(e.target.checked)}
                    />
                    {t.orders.hub.replaceTender}
                  </label>
                  {replaceTender ? (
                    <>
                      <p className="text-muted-foreground text-xs">
                        {t.orders.hub.replaceTenderHint}
                      </p>
                      {tenderRows.map((row, index) => (
                        <div
                          key={`${row.methodId}-${index}`}
                          className="grid grid-cols-2 gap-2"
                        >
                          <div className="space-y-1">
                            <Label className="text-xs">{t.pos.payment.method}</Label>
                            <select
                              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                              value={row.methodId}
                              onChange={(e) =>
                                setTenderRows((prev) =>
                                  prev.map((r, i) =>
                                    i === index
                                      ? { ...r, methodId: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            >
                              {paymentMethods.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{t.pos.payment.amount}</Label>
                            <Input
                              type="number"
                              dir="ltr"
                              value={row.amount}
                              onChange={(e) =>
                                setTenderRows((prev) =>
                                  prev.map((r, i) =>
                                    i === index
                                      ? { ...r, amount: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                      {tenderRows.length < paymentMethods.length ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const next = paymentMethods.find(
                              (m) => !tenderRows.some((r) => r.methodId === m.id),
                            )
                            if (!next) return
                            setTenderRows((prev) => [
                              ...prev,
                              { methodId: next.id, amount: '' },
                            ])
                          }}
                        >
                          {t.pos.payment.addTender}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {t.orders.hub.keepTender}
                    </p>
                  )}
                </div>
              </div>

              <div className="shrink-0 space-y-3 border-t bg-white p-3">
                <OrderMoneySummary
                  money={liveMoney}
                  subtotal={cart.subtotal}
                  discountAmount={Number(detail.order.discount_amount ?? 0)}
                />
                {!replaceTender ? (
                  <p className="text-muted-foreground text-xs">
                    {t.orders.hub.collectedLocked}: {formatMoney(lockedCollected)}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="min-h-12 w-full rounded-2xl bg-[#22c55e] text-base font-semibold hover:bg-[#16a34a]"
                  disabled={saving || cart.lines.length === 0}
                  onClick={() => void handleSave()}
                >
                  {t.orders.hub.saveEdit}
                </Button>
              </div>
            </aside>
          </div>
        )}

        <ModifierPickerDialog
          item={modifierItem}
          open={modifierItem !== null}
          onOpenChange={(o) => !o && setModifierItem(null)}
          onConfirm={(ids) => {
            if (modifierItem) cart.addItem(modifierItem, { modifierOptionIds: ids })
            setModifierItem(null)
          }}
        />
        <LineExtrasDialog
          open={extrasLine !== null}
          onOpenChange={(o) => !o && setExtrasLine(null)}
          lineName={extrasLine?.name ?? ''}
          initialNote={
            extrasLine
              ? (cart.lines.find((l) => l.key === extrasLine.key)?.note ??
                extrasLine.note)
              : undefined
          }
          categories={menu?.categories}
          onToggleSauce={(sauceName) => {
            if (!extrasLine) return
            const live =
              cart.lines.find((l) => l.key === extrasLine.key) ?? extrasLine
            const sauceNames = freeSauceMenuItems(menu?.categories).map(
              (s) => s.name,
            )
            const next = toggleSauceInNote(live.note, sauceName, sauceNames)
            cart.updateNote(extrasLine.key, next)
          }}
          onSaveNote={(note) => {
            if (extrasLine) cart.updateNote(extrasLine.key, note)
            setExtrasLine(null)
          }}
        />
        <OpenPriceDialog
          item={openPriceItem}
          open={openPriceItem !== null}
          onOpenChange={(o) => !o && setOpenPriceItem(null)}
          onConfirm={(price) => {
            if (openPriceItem) cart.addItem(openPriceItem, { openPrice: price })
            setOpenPriceItem(null)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
