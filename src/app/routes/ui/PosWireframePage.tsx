/**
 * TEMPORARY UI wireframe — mock data only, no Backend / RPC / financial logic.
 * Route: /ui/pos-wireframe — remove after M5 POS UX is approved & wired.
 *
 * Layout (v2 per review):
 * - Side nav (no bottom bar)
 * - Center = Orders Hub
 * - «إنشاء طلب» opens create-order dialog, then sell dialog
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Minus,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  ShoppingBag,
  Bike,
  X,
  LayoutList,
  PauseCircle,
  Wallet,
  Wrench,
  LogOut,
  PlusCircle,
  Printer,
  Pencil,
  Banknote,
  Clock3,
  FileText,
} from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/utils/cn'

type OrderType = 'dine_in' | 'takeaway' | 'delivery'
type PayMode = 'now' | 'later'
type CustomerMode = 'walkin' | 'pick' | 'new'
type HubFilter =
  | 'all'
  | 'unpaid'
  | 'partial'
  | 'review'
  | 'held'
  | 'dine_in'
  | 'takeaway'
  | 'delivery'
  | 'ready'

type Overlay =
  | null
  | 'new-order'
  | 'sell'
  | 'pay'
  | 'ops'
  | 'summary'
  | 'shift'

type MockLine = {
  id: string
  name: string
  qty: number
  unit: number
  modifiers?: string
}

type MockOrder = {
  id: string
  ref: string
  customer: string
  time: string
  itemCount: number
  total: number
  collected: number
  remaining: number
  payment: 'unpaid' | 'partial' | 'paid'
  type: OrderType
  fulfillment: 'new' | 'preparing' | 'ready' | 'delivered'
  needsReview?: boolean
  held?: boolean
}

type HeldOrder = MockOrder & { lines: MockLine[] }

const MENU = [
  { id: '1', name: 'برجر كلاسيك', price: 45, cat: 'برجر' },
  { id: '2', name: 'برجر دبل', price: 65, cat: 'برجر' },
  { id: '3', name: 'بطاطس', price: 25, cat: 'إضافات' },
  { id: '4', name: 'كولا', price: 15, cat: 'مشروبات' },
  { id: '5', name: 'شاورما', price: 55, cat: 'سندويتش' },
  { id: '6', name: 'سلطة', price: 30, cat: 'إضافات' },
  { id: '7', name: 'عصير', price: 20, cat: 'مشروبات' },
  { id: '8', name: 'تشيكن راب', price: 50, cat: 'سندويتش' },
]

const SAMPLE_ORDERS: MockOrder[] = [
  {
    id: 'o1',
    ref: 'ORD-1042',
    customer: 'أحمد محمد',
    time: '14:22',
    itemCount: 4,
    total: 230,
    collected: 0,
    remaining: 230,
    payment: 'unpaid',
    type: 'delivery',
    fulfillment: 'preparing',
  },
  {
    id: 'o2',
    ref: 'ORD-1041',
    customer: 'Walk-in',
    time: '14:18',
    itemCount: 2,
    total: 85,
    collected: 40,
    remaining: 45,
    payment: 'partial',
    type: 'takeaway',
    fulfillment: 'ready',
  },
  {
    id: 'o3',
    ref: 'ORD-1040',
    customer: 'سارة علي',
    time: '14:05',
    itemCount: 3,
    total: 160,
    collected: 160,
    remaining: 0,
    payment: 'paid',
    type: 'dine_in',
    fulfillment: 'delivered',
  },
  {
    id: 'o4',
    ref: 'ORD-1039',
    customer: 'خالد',
    time: '13:50',
    itemCount: 1,
    total: 45,
    collected: 45,
    remaining: 0,
    payment: 'paid',
    type: 'takeaway',
    fulfillment: 'ready',
    needsReview: true,
  },
  {
    id: 'o5',
    ref: 'HOLD-03',
    customer: 'عميل يفكر',
    time: '14:10',
    itemCount: 2,
    total: 95,
    collected: 0,
    remaining: 95,
    payment: 'unpaid',
    type: 'takeaway',
    fulfillment: 'new',
    held: true,
  },
  {
    id: 'o6',
    ref: 'HOLD-02',
    customer: 'Walk-in',
    time: '13:58',
    itemCount: 1,
    total: 35,
    collected: 0,
    remaining: 35,
    payment: 'unpaid',
    type: 'dine_in',
    fulfillment: 'new',
    held: true,
  },
]

const FILTERS: { id: HubFilter; label: string }[] = [
  { id: 'all', label: 'كل الطلبات' },
  { id: 'unpaid', label: 'غير محصل' },
  { id: 'partial', label: 'دفع جزئي' },
  { id: 'review', label: 'يحتاج مراجعة' },
  { id: 'held', label: 'معلق' },
  { id: 'dine_in', label: 'داخل المطعم' },
  { id: 'takeaway', label: 'استلام' },
  { id: 'delivery', label: 'دليفري' },
  { id: 'ready', label: 'جاهز' },
]

function money(n: number) {
  return n.toFixed(2)
}

function typeLabel(t: OrderType) {
  if (t === 'dine_in') return 'داخل المطعم'
  if (t === 'delivery') return 'دليفري'
  return 'استلام'
}

function paymentLabel(p: MockOrder['payment']) {
  if (p === 'unpaid') return 'غير محصل'
  if (p === 'partial') return 'جزئي'
  return 'محصل'
}

/** Visual language scoped to this wireframe only (reference POS look). */
const wf = {
  page: 'bg-[#eef1f6] text-[#1e293b]',
  card: 'rounded-2xl border border-white/80 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]',
  cardSoft:
    'rounded-2xl border border-[#e8ecf2] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.05)]',
  blue: 'bg-[#3b82f6] hover:bg-[#2563eb]',
  green: 'bg-[#22c55e] hover:bg-[#16a34a]',
  orange: 'bg-[#f97316] hover:bg-[#ea580c]',
  totalBox: 'rounded-2xl bg-[#dcfce7] text-[#15803d]',
}

function paymentBadgeClass(p: MockOrder['payment']) {
  if (p === 'paid') return 'border-[#86efac] bg-[#dcfce7] text-[#15803d]'
  if (p === 'partial') return 'border-[#fde68a] bg-[#fef3c7] text-[#b45309]'
  return 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
}

function typeBadgeClass(t: OrderType) {
  if (t === 'dine_in') return 'border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb]'
  if (t === 'delivery') return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
  return 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
}

function TouchBtn({
  children,
  className,
  variant = 'outline',
  active,
  tone,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: 'outline' | 'solid' | 'ghost' | 'danger'
  active?: boolean
  tone?: 'green' | 'blue' | 'yellow' | 'red' | 'neutral' | 'orange'
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-all disabled:opacity-40',
        variant === 'outline' &&
          'border border-[#e2e8f0] bg-white text-[#334155] shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:bg-[#f8fafc]',
        variant === 'ghost' && 'text-[#64748b] hover:bg-[#f1f5f9]',
        variant === 'solid' && 'text-white shadow-[0_4px_14px_rgba(15,23,42,0.12)]',
        variant === 'danger' &&
          'border border-[#fecaca] bg-[#fef2f2] text-[#dc2626]',
        tone === 'green' && variant === 'solid' && wf.green,
        tone === 'blue' && variant === 'solid' && wf.blue,
        tone === 'orange' && variant === 'solid' && wf.orange,
        tone === 'yellow' &&
          variant === 'solid' &&
          'bg-[#fbbf24] text-[#78350f] hover:bg-[#f59e0b]',
        tone === 'red' &&
          variant === 'solid' &&
          'bg-[#ef4444] hover:bg-[#dc2626]',
        tone === 'neutral' &&
          variant === 'solid' &&
          'bg-[#334155] hover:bg-[#1e293b]',
        !tone && variant === 'solid' && wf.blue,
        active &&
          variant === 'outline' &&
          'border-[#93c5fd] bg-[#eff6ff] text-[#2563eb] shadow-[0_2px_8px_rgba(59,130,246,0.15)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function OverlayShell({
  title,
  onClose,
  wide,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f172a]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
      <div
        className={cn(
          'flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] sm:rounded-3xl',
          wide ? 'sm:max-w-6xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-[#eef2f7] px-5 py-4">
          <h2 className="text-lg font-bold text-[#0f172a]">{title}</h2>
          <TouchBtn variant="ghost" className="min-h-10 px-3" onClick={onClose}>
            <X className="size-5" />
          </TouchBtn>
        </div>
        <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-4 sm:p-5">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-[#eef2f7] bg-white p-4">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}

function filterCount(f: HubFilter, orders: MockOrder[], heldLen: number) {
  if (f === 'held') return heldLen
  return orders.filter((o) => {
    switch (f) {
      case 'all':
        return !o.held
      case 'unpaid':
        return o.payment === 'unpaid' && !o.held
      case 'partial':
        return o.payment === 'partial'
      case 'review':
        return Boolean(o.needsReview)
      case 'dine_in':
        return o.type === 'dine_in' && !o.held
      case 'takeaway':
        return o.type === 'takeaway' && !o.held
      case 'delivery':
        return o.type === 'delivery'
      case 'ready':
        return o.fulfillment === 'ready'
      default:
        return false
    }
  }).length
}

export function PosWireframePage() {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [sideView, setSideView] = useState<'orders' | 'held'>('orders')
  const [hasActiveOrder, setHasActiveOrder] = useState(false)
  const [orderMeta, setOrderMeta] = useState({
    ref: 'ORD-1043',
    type: 'takeaway' as OrderType,
    payMode: 'later' as PayMode,
    customer: 'Walk-in',
  })
  const [lines, setLines] = useState<MockLine[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('المفضلة')
  const [hubFilter, setHubFilter] = useState<HubFilter>('all')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [nType, setNType] = useState<OrderType>('takeaway')
  const [nPay, setNPay] = useState<PayMode>('later')
  const [nCust, setNCust] = useState<CustomerMode>('walkin')
  const [nName, setNName] = useState('')
  const [nPhone, setNPhone] = useState('')
  const [nAddress, setNAddress] = useState('')
  const [nNote, setNNote] = useState('')

  const [held, setHeld] = useState<HeldOrder[]>(
    SAMPLE_ORDERS.filter((o) => o.held).map((o) => ({
      ...o,
      lines: [
        { id: 'h1', name: 'برجر كلاسيك', qty: 1, unit: 45 },
        { id: 'h2', name: 'كولا', qty: 1, unit: 15 },
      ],
    })),
  )

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.unit * l.qty, 0),
    [lines],
  )
  const collected = 0
  const remaining = Math.max(subtotal - collected, 0)

  const categories = ['المفضلة', 'برجر', 'سندويتش', 'مشروبات', 'إضافات']
  const visibleMenu = MENU.filter((m) => {
    if (search.trim()) return m.name.includes(search.trim())
    if (category === 'المفضلة') return ['1', '3', '4', '5'].includes(m.id)
    return m.cat === category
  })

  const centerOrders =
    sideView === 'held' || hubFilter === 'held'
      ? held
      : SAMPLE_ORDERS.filter((o) => {
          switch (hubFilter) {
            case 'all':
              return !o.held
            case 'unpaid':
              return o.payment === 'unpaid' && !o.held
            case 'partial':
              return o.payment === 'partial'
            case 'review':
              return Boolean(o.needsReview)
            case 'dine_in':
              return o.type === 'dine_in' && !o.held
            case 'takeaway':
              return o.type === 'takeaway' && !o.held
            case 'delivery':
              return o.type === 'delivery'
            case 'ready':
              return o.fulfillment === 'ready'
            default:
              return !o.held
          }
        })

  const selectedOrder =
    SAMPLE_ORDERS.find((o) => o.id === selectedOrderId) ??
    held.find((o) => o.id === selectedOrderId) ??
    null

  const canFreeEdit = selectedOrder
    ? !selectedOrder.held && selectedOrder.payment !== 'paid'
    : false

  const mockSummaryLines = [
    { name: 'برجر كلاسيك', qty: 2, unit: 45, total: 90 },
    { name: 'بطاطس', qty: 1, unit: 25, total: 25 },
    { name: 'كولا', qty: 1, unit: 15, total: 15 },
  ]

  const mockTimeline = [
    { label: 'تم إنشاء الطلب', at: '14:22' },
    { label: 'تم تسجيل التحصيل (معلّق)', at: '14:23' },
    { label: 'تحديث حالة التنفيذ → قيد التحضير', at: '14:25' },
  ]

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  function addItem(item: (typeof MENU)[0]) {
    setLines((prev) => {
      const existing = prev.find((l) => l.name === item.name && !l.modifiers)
      if (existing) {
        return prev.map((l) =>
          l.id === existing.id ? { ...l, qty: l.qty + 1 } : l,
        )
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: item.name,
          qty: 1,
          unit: item.price,
        },
      ]
    })
  }

  function openCreateOrder() {
    setNType('takeaway')
    setNPay('later')
    setNCust('walkin')
    setNName('')
    setNPhone('')
    setNAddress('')
    setNNote('')
    setOverlay('new-order')
  }

  function createOrder() {
    const customer =
      nCust === 'walkin'
        ? 'Walk-in'
        : nName.trim() || (nCust === 'pick' ? 'عميل مسجل' : 'عميل جديد')
    setOrderMeta({
      ref: `ORD-${1040 + Math.floor(Math.random() * 50)}`,
      type: nType,
      payMode: nPay,
      customer,
    })
    setLines([])
    setHasActiveOrder(true)
    setSideView('orders')
    setOverlay('sell')
    flash('تم إنشاء الطلب — أضف الأصناف')
  }

  function holdOrder() {
    if (!hasActiveOrder || lines.length === 0) {
      flash('السلة فارغة')
      return
    }
    setHeld((prev) => [
      {
        id: crypto.randomUUID(),
        ref: `HOLD-${String(prev.length + 1).padStart(2, '0')}`,
        customer: orderMeta.customer,
        time: new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        itemCount: lines.reduce((s, l) => s + l.qty, 0),
        total: subtotal,
        collected: 0,
        remaining: subtotal,
        payment: 'unpaid',
        type: orderMeta.type,
        fulfillment: 'new',
        held: true,
        lines: [...lines],
      },
      ...prev,
    ])
    setLines([])
    setHasActiveOrder(false)
    setOverlay(null)
    setSideView('orders')
    setHubFilter('held')
    flash('تم تعليق الطلب')
  }

  function resumeHeld(id: string) {
    const h = held.find((x) => x.id === id)
    if (!h) return
    setHeld((prev) => prev.filter((x) => x.id !== id))
    setLines(h.lines)
    setOrderMeta({
      ref: h.ref,
      type: h.type,
      payMode: 'later',
      customer: h.customer,
    })
    setHasActiveOrder(true)
    setOverlay('sell')
    flash('تم استئناف الطلب')
  }

  function closeSellToHub() {
    setOverlay(null)
  }

  return (
    <div className={cn(wf.page, 'flex h-dvh flex-col overflow-hidden')} dir="rtl">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#fde68a] bg-[#fffbeb] px-3 py-1.5 text-xs font-medium text-[#92400e]">
        <span>
          Wireframe v3 — ملخص طلب · إعادة طباعة · تحصيل · تعديل (خصائص الخطة)
        </span>
        <Link to="/health" className="underline">
          Health
        </Link>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* —— Side bar —— */}
        <aside className="z-10 flex w-[92px] shrink-0 flex-col bg-white shadow-[4px_0_24px_rgba(15,23,42,0.06)] sm:w-[120px]">
          <div className="border-b border-[#eef2f7] px-2 py-4 text-center">
            <p className="truncate text-sm font-bold text-[#0f172a]">محمد</p>
            <p className="text-[11px] text-[#64748b]">كاشير</p>
            <p className="mt-1 text-[10px] text-[#94a3b8]" dir="ltr">
              SH-019
            </p>
          </div>

          <div className="p-2.5">
            <TouchBtn
              variant="solid"
              tone="green"
              className="h-auto min-h-[76px] w-full flex-col gap-1.5 px-1 text-xs leading-tight shadow-[0_6px_16px_rgba(34,197,94,0.35)]"
              onClick={openCreateOrder}
            >
              <PlusCircle className="size-7" />
              إنشاء طلب
            </TouchBtn>
          </div>

          <nav className="flex flex-1 flex-col gap-1.5 p-2">
            <SideNavBtn
              active={sideView === 'orders' && !overlay}
              icon={LayoutList}
              label="الطلبات"
              onClick={() => {
                setSideView('orders')
                setHubFilter('all')
                setOverlay(null)
              }}
            />
            <SideNavBtn
              active={sideView === 'held' || hubFilter === 'held'}
              icon={PauseCircle}
              label={`معلق (${held.length})`}
              onClick={() => {
                setSideView('held')
                setHubFilter('held')
                setOverlay(null)
              }}
            />
            <SideNavBtn
              active={overlay === 'shift'}
              icon={Wallet}
              label="الوردية"
              onClick={() => setOverlay('shift')}
            />
            <SideNavBtn
              active={overlay === 'ops'}
              icon={Wrench}
              label="أدوات"
              onClick={() => setOverlay('ops')}
            />
          </nav>

          <div className="space-y-1 border-t border-[#eef2f7] p-2">
            <p className="px-1 text-[10px] text-[#64748b]">
              الدرج{' '}
              <span className="font-bold text-[#0f172a]" dir="ltr">
                1,250
              </span>
            </p>
            <SideNavBtn icon={LogOut} label="خروج" onClick={() => undefined} />
          </div>
        </aside>

        {/* —— Center —— */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Title row */}
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
            <div>
              <h1 className="text-xl font-bold text-[#0f172a]">
                {sideView === 'held' || hubFilter === 'held'
                  ? 'الطلبات المعلقة'
                  : 'الطلبات'}
              </h1>
              <p className="text-xs text-[#64748b]">
                مركز التشغيل — افتح أي طلب بضغطة
              </p>
            </div>
            {hasActiveOrder ? (
              <TouchBtn
                variant="solid"
                tone="blue"
                className="min-h-11 shadow-[0_6px_16px_rgba(59,130,246,0.3)]"
                onClick={() => setOverlay('sell')}
              >
                متابعة الطلب · {orderMeta.ref}
              </TouchBtn>
            ) : null}
          </header>

          {/* Filters — top strip alone (outside order cards) */}
          <div className="shrink-0 px-4 pb-3">
            <div className={cn(wf.card, 'overflow-x-auto p-3')}>
              <p className="mb-2 text-xs font-semibold text-[#64748b]">
                الفلاتر
              </p>
              <div className="flex min-w-max gap-2">
                {FILTERS.map((f) => {
                  const count = filterCount(f.id, SAMPLE_ORDERS, held.length)
                  const active =
                    hubFilter === f.id ||
                    (f.id === 'held' && sideView === 'held')
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setHubFilter(f.id)
                        setSideView(f.id === 'held' ? 'held' : 'orders')
                      }}
                      className={cn(
                        'min-w-[112px] rounded-2xl border px-3 py-3 text-right transition-all',
                        active
                          ? 'border-[#93c5fd] bg-[#eff6ff] shadow-[0_4px_14px_rgba(59,130,246,0.18)]'
                          : 'border-[#eef2f7] bg-[#f8fafc] hover:bg-white hover:shadow-[0_2px_10px_rgba(15,23,42,0.06)]',
                      )}
                    >
                      <p
                        className={cn(
                          'text-xs font-semibold',
                          active ? 'text-[#2563eb]' : 'text-[#475569]',
                        )}
                      >
                        {f.label}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-2xl font-bold',
                          active ? 'text-[#2563eb]' : 'text-[#0f172a]',
                        )}
                      >
                        {count}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Order cards */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {centerOrders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={cn(
                    wf.cardSoft,
                    'p-4 text-right transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.1)] active:scale-[0.99]',
                  )}
                  onClick={() => {
                    if (o.held) {
                      resumeHeld(o.id)
                      return
                    }
                    setSelectedOrderId(o.id)
                    setOverlay('summary')
                  }}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-bold text-[#0f172a]" dir="ltr">
                        {o.ref}
                      </p>
                      <p className="text-sm text-[#334155]">{o.customer}</p>
                    </div>
                    <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-xs text-[#64748b]">
                      {o.time}
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span
                      className={cn(
                        'rounded-lg border px-2 py-0.5 text-xs font-medium',
                        paymentBadgeClass(o.payment),
                      )}
                    >
                      {paymentLabel(o.payment)}
                    </span>
                    <span
                      className={cn(
                        'rounded-lg border px-2 py-0.5 text-xs font-medium',
                        typeBadgeClass(o.type),
                      )}
                    >
                      {typeLabel(o.type)}
                    </span>
                    {o.held ? (
                      <span className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-xs font-medium text-[#b45309]">
                        معلق
                      </span>
                    ) : null}
                    {o.needsReview ? (
                      <span className="rounded-lg border border-[#fde68a] bg-[#fef3c7] px-2 py-0.5 text-xs font-medium text-[#b45309]">
                        مراجعة
                      </span>
                    ) : null}
                    {o.fulfillment === 'ready' ? (
                      <span className="rounded-lg border border-[#86efac] bg-[#dcfce7] px-2 py-0.5 text-xs font-medium text-[#15803d]">
                        جاهز
                      </span>
                    ) : null}
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-[#64748b]">
                    <span className="rounded-xl bg-[#f8fafc] px-2 py-1.5">
                      {o.itemCount} أصناف
                    </span>
                    <span className="rounded-xl bg-[#f8fafc] px-2 py-1.5 text-end">
                      الإجمالي{' '}
                      <strong className="text-[#0f172a]" dir="ltr">
                        {money(o.total)}
                      </strong>
                    </span>
                    <span className="rounded-xl bg-[#f8fafc] px-2 py-1.5">
                      المحصل{' '}
                      <strong className="text-[#0f172a]" dir="ltr">
                        {money(o.collected)}
                      </strong>
                    </span>
                    <span
                      className={cn(
                        'rounded-xl px-2 py-1.5 text-end font-semibold',
                        o.remaining > 0 ? wf.totalBox : 'bg-[#f8fafc]',
                      )}
                    >
                      المتبقي{' '}
                      <strong dir="ltr">{money(o.remaining)}</strong>
                    </span>
                  </div>
                  {/* Planned ops — visible on card */}
                  <div
                    className="flex gap-1.5 border-t border-[#eef2f7] pt-3"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-[#eff6ff] text-[11px] font-semibold text-[#2563eb]">
                      <FileText className="size-3.5" />
                      ملخص
                    </span>
                    {o.remaining > 0 ? (
                      <span className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-[#fff7ed] text-[11px] font-semibold text-[#c2410c]">
                        <Banknote className="size-3.5" />
                        تحصيل
                      </span>
                    ) : null}
                    <span className="inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-[#f8fafc] text-[11px] font-semibold text-[#475569]">
                      <Printer className="size-3.5" />
                      طباعة
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {centerOrders.length === 0 ? (
              <div
                className={cn(
                  wf.card,
                  'mx-auto mt-8 flex max-w-md flex-col items-center gap-3 py-16 text-center',
                )}
              >
                <LayoutList className="size-14 text-[#cbd5e1]" />
                <p className="text-sm text-[#64748b]">
                  لا توجد طلبات في هذا الفلتر
                </p>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {toast ? (
        <div className="fixed top-14 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-[#22c55e] px-4 py-2.5 text-sm font-medium text-white shadow-[0_8px_24px_rgba(34,197,94,0.35)]">
          {toast}
        </div>
      ) : null}

      {/* Create order dialog */}
      {overlay === 'new-order' ? (
        <OverlayShell title="إنشاء طلب جديد" onClose={() => setOverlay(null)}>
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="font-semibold">نوع الطلب</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'dine_in' as const,
                      label: 'داخل المطعم',
                      icon: UtensilsCrossed,
                    },
                    {
                      id: 'takeaway' as const,
                      label: 'استلام',
                      icon: ShoppingBag,
                    },
                    { id: 'delivery' as const, label: 'دليفري', icon: Bike },
                  ] as const
                ).map((opt) => (
                  <TouchBtn
                    key={opt.id}
                    active={nType === opt.id}
                    className="min-h-20 flex-col"
                    onClick={() => setNType(opt.id)}
                  >
                    <opt.icon className="size-6" />
                    {opt.label}
                  </TouchBtn>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                داخل المطعم = يأكل في المكان فقط — بدون طاولات.
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-semibold">حالة التحصيل</p>
              <div className="grid grid-cols-2 gap-2">
                <TouchBtn
                  active={nPay === 'now'}
                  className="min-h-14"
                  onClick={() => setNPay('now')}
                >
                  محصل
                </TouchBtn>
                <TouchBtn
                  active={nPay === 'later'}
                  className="min-h-14"
                  onClick={() => setNPay('later')}
                >
                  غير محصل
                </TouchBtn>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold">العميل</p>
              <div className="grid gap-2">
                {(
                  [
                    { id: 'walkin' as const, label: 'عميل عادي (Walk-in)' },
                    { id: 'pick' as const, label: 'اختيار عميل مسجل' },
                    { id: 'new' as const, label: 'إنشاء عميل جديد' },
                  ] as const
                ).map((opt) => (
                  <TouchBtn
                    key={opt.id}
                    active={nCust === opt.id}
                    className="min-h-12 justify-start"
                    onClick={() => setNCust(opt.id)}
                  >
                    {opt.label}
                  </TouchBtn>
                ))}
              </div>
            </div>

            {nType === 'delivery' || nCust !== 'walkin' ? (
              <div className="space-y-2">
                <p className="font-semibold">بيانات التواصل</p>
                <Input
                  className="h-12 rounded-xl"
                  placeholder="الاسم"
                  value={nName}
                  onChange={(e) => setNName(e.target.value)}
                />
                <Input
                  className="h-12 rounded-xl"
                  placeholder="رقم الهاتف"
                  dir="ltr"
                  value={nPhone}
                  onChange={(e) => setNPhone(e.target.value)}
                />
                {nType === 'delivery' ? (
                  <>
                    <Input
                      className="h-12 rounded-xl"
                      placeholder="العنوان"
                      value={nAddress}
                      onChange={(e) => setNAddress(e.target.value)}
                    />
                    <Input
                      className="h-12 rounded-xl"
                      placeholder="ملاحظات"
                      value={nNote}
                      onChange={(e) => setNNote(e.target.value)}
                    />
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2 pt-2">
              <TouchBtn
                variant="ghost"
                className="min-h-14 flex-1"
                onClick={() => setOverlay(null)}
              >
                إلغاء
              </TouchBtn>
              <TouchBtn
                variant="solid"
                tone="green"
                className="min-h-14 flex-[2] shadow-[0_6px_18px_rgba(34,197,94,0.35)]"
                onClick={createOrder}
              >
                إنشاء الطلب
              </TouchBtn>
            </div>
          </div>
        </OverlayShell>
      ) : null}

      {/* Sell dialog — after create / resume */}
      {overlay === 'sell' ? (
        <OverlayShell
          title={`البيع · ${orderMeta.ref}`}
          onClose={closeSellToHub}
          wide
          footer={
            <div className="flex flex-wrap gap-2">
              <TouchBtn
                className="min-h-12"
                disabled={lines.length === 0}
                onClick={holdOrder}
              >
                تعليق الطلب
              </TouchBtn>
              <TouchBtn
                variant="ghost"
                className="min-h-12"
                onClick={closeSellToHub}
              >
                العودة للطلبات
              </TouchBtn>
              <TouchBtn
                variant="solid"
                tone="green"
                className="min-h-14 min-w-[180px] flex-1 text-base shadow-[0_6px_18px_rgba(34,197,94,0.35)]"
                disabled={lines.length === 0}
                onClick={() => setOverlay('pay')}
              >
                إتمام البيع · {money(remaining)}
              </TouchBtn>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Badge className={typeBadgeClass(orderMeta.type)}>
              {typeLabel(orderMeta.type)}
            </Badge>
            <Badge
              className={
                orderMeta.payMode === 'now'
                  ? paymentBadgeClass('paid')
                  : paymentBadgeClass('unpaid')
              }
            >
              {orderMeta.payMode === 'now' ? 'محصل (عند الدفع)' : 'غير محصل'}
            </Badge>
            <Badge variant="secondary">{orderMeta.customer}</Badge>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
            <section className={cn(wf.card, 'space-y-3 p-4')}>
              <div className="relative">
                <Search className="absolute top-1/2 right-3 size-5 -translate-y-1/2 text-[#94a3b8]" />
                <Input
                  className="h-12 rounded-2xl border-[#e2e8f0] bg-[#f8fafc] pr-10 text-base shadow-none"
                  placeholder="بحث عن منتج…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {!search.trim() ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {categories.map((c) => (
                    <TouchBtn
                      key={c}
                      active={category === c}
                      className="shrink-0"
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </TouchBtn>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {visibleMenu.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addItem(item)}
                    className="min-h-[88px] rounded-2xl border border-[#eef2f7] bg-[#f8fafc] p-3 text-right shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-all hover:border-[#93c5fd] hover:bg-white hover:shadow-[0_4px_14px_rgba(59,130,246,0.12)] active:scale-[0.98]"
                  >
                    <p className="line-clamp-2 text-sm font-semibold text-[#0f172a]">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#3b82f6]" dir="ltr">
                      {money(item.price)}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <aside className={cn(wf.card, 'flex flex-col p-4')}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-[#0f172a]">السلة</h3>
                {lines.length > 0 ? (
                  <TouchBtn
                    variant="danger"
                    className="min-h-9 px-3 text-xs"
                    onClick={() => setLines([])}
                  >
                    إفراغ
                  </TouchBtn>
                ) : null}
              </div>
              <div className="max-h-[36vh] flex-1 space-y-2 overflow-y-auto">
                {lines.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <ShoppingBag className="size-12 text-[#cbd5e1]" />
                    <p className="text-sm text-[#64748b]">اختر منتجات</p>
                  </div>
                ) : (
                  lines.map((line) => (
                    <div
                      key={line.id}
                      className="rounded-2xl border border-[#eef2f7] bg-[#f8fafc] p-2.5"
                    >
                      <div className="flex justify-between gap-2">
                        <p className="font-medium text-[#0f172a]">{line.name}</p>
                        <button
                          type="button"
                          className="text-[#ef4444]"
                          onClick={() =>
                            setLines((prev) =>
                              prev.filter((l) => l.id !== line.id),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <TouchBtn
                            className="size-10 min-h-10 px-0"
                            onClick={() =>
                              setLines((prev) =>
                                prev
                                  .map((l) =>
                                    l.id === line.id
                                      ? { ...l, qty: l.qty - 1 }
                                      : l,
                                  )
                                  .filter((l) => l.qty > 0),
                              )
                            }
                          >
                            <Minus className="size-4" />
                          </TouchBtn>
                          <span
                            className="w-8 text-center font-semibold"
                            dir="ltr"
                          >
                            {line.qty}
                          </span>
                          <TouchBtn
                            className="size-10 min-h-10 px-0"
                            onClick={() =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id
                                    ? { ...l, qty: l.qty + 1 }
                                    : l,
                                ),
                              )
                            }
                          >
                            <Plus className="size-4" />
                          </TouchBtn>
                        </div>
                        <span className="font-bold text-[#0f172a]" dir="ltr">
                          {money(line.unit * line.qty)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 space-y-2 border-t border-[#eef2f7] pt-3 text-sm">
                <div className="flex justify-between text-[#64748b]">
                  <span>الإجمالي</span>
                  <strong className="text-[#0f172a]" dir="ltr">
                    {money(subtotal)}
                  </strong>
                </div>
                <div className="flex justify-between text-[#64748b]">
                  <span>المحصل</span>
                  <span className="text-[#0f172a]" dir="ltr">
                    {money(collected)}
                  </span>
                </div>
                <div
                  className={cn(
                    wf.totalBox,
                    'flex items-center justify-between px-3 py-3 text-base font-bold',
                  )}
                >
                  <span>المتبقي</span>
                  <span dir="ltr">{money(remaining)}</span>
                </div>
              </div>
            </aside>
          </div>
        </OverlayShell>
      ) : null}

      {overlay === 'pay' ? (
        <OverlayShell title="الدفع / التحصيل" onClose={() => setOverlay('sell')}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: 'الإجمالي', v: subtotal, box: 'bg-[#f8fafc]' },
                { l: 'المحصل', v: collected, box: 'bg-[#eff6ff]' },
                { l: 'المتبقي', v: remaining, box: 'bg-[#dcfce7] text-[#15803d]' },
              ].map((x) => (
                <div
                  key={x.l}
                  className={cn(
                    'rounded-2xl border border-[#eef2f7] p-3 text-center shadow-[0_1px_4px_rgba(15,23,42,0.04)]',
                    x.box,
                  )}
                >
                  <p className="text-xs text-[#64748b]">{x.l}</p>
                  <p className="text-lg font-bold" dir="ltr">
                    {money(x.v)}
                  </p>
                </div>
              ))}
            </div>
            <Input
              className="h-12 rounded-2xl border-[#e2e8f0] bg-white"
              dir="ltr"
              defaultValue={money(remaining)}
            />
            <TouchBtn
              variant="solid"
              tone="green"
              className="w-full min-h-14 shadow-[0_6px_18px_rgba(34,197,94,0.35)]"
              onClick={() => {
                setLines([])
                setHasActiveOrder(false)
                setOverlay(null)
                flash('تم التحصيل (وهمي)')
              }}
            >
              تأكيد التحصيل
            </TouchBtn>
          </div>
        </OverlayShell>
      ) : null}

      {overlay === 'summary' && selectedOrder ? (
        <OverlayShell
          title={`ملخص الطلب · ${selectedOrder.ref}`}
          onClose={() => {
            setOverlay(null)
            setSelectedOrderId(null)
          }}
          wide
          footer={
            <div className="grid gap-2 sm:grid-cols-3">
              <TouchBtn
                variant="solid"
                tone="blue"
                className="min-h-14 shadow-[0_6px_16px_rgba(59,130,246,0.28)]"
                disabled={!canFreeEdit && selectedOrder.payment === 'paid'}
                onClick={() => {
                  if (selectedOrder.payment === 'paid') {
                    flash('بعد الاعتماد: مسار Amend فقط (ADR-0026)')
                    return
                  }
                  setHasActiveOrder(true)
                  setOrderMeta({
                    ref: selectedOrder.ref,
                    type: selectedOrder.type,
                    payMode: selectedOrder.payment === 'unpaid' ? 'later' : 'now',
                    customer: selectedOrder.customer,
                  })
                  setLines(
                    mockSummaryLines.map((l) => ({
                      id: crypto.randomUUID(),
                      name: l.name,
                      qty: l.qty,
                      unit: l.unit,
                    })),
                  )
                  setOverlay('sell')
                }}
              >
                <Pencil className="size-5" />
                تعديل الطلب
              </TouchBtn>
              <TouchBtn
                variant="solid"
                tone="orange"
                className="min-h-14 shadow-[0_6px_16px_rgba(249,115,22,0.28)]"
                disabled={selectedOrder.remaining <= 0}
                onClick={() => {
                  setOrderMeta({
                    ref: selectedOrder.ref,
                    type: selectedOrder.type,
                    payMode: 'later',
                    customer: selectedOrder.customer,
                  })
                  setLines([])
                  setHasActiveOrder(true)
                  setOverlay('pay')
                }}
              >
                <Banknote className="size-5" />
                تحصيل المتبقي
              </TouchBtn>
              <TouchBtn
                variant="outline"
                className="min-h-14 border-[#cbd5e1]"
                onClick={() => flash('إعادة طباعة الإيصال (وهمي)')}
              >
                <Printer className="size-5" />
                إعادة طباعة
              </TouchBtn>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Status + planned features callout */}
            <div className="flex flex-wrap gap-2">
              <Badge className={paymentBadgeClass(selectedOrder.payment)}>
                {paymentLabel(selectedOrder.payment)}
              </Badge>
              <Badge className={typeBadgeClass(selectedOrder.type)}>
                {typeLabel(selectedOrder.type)}
              </Badge>
              {selectedOrder.needsReview ? (
                <Badge className="border-[#fde68a] bg-[#fef3c7] text-[#b45309]">
                  يحتاج مراجعة
                </Badge>
              ) : null}
              {selectedOrder.payment === 'paid' ? (
                <Badge className="border-[#fecaca] bg-[#fef2f2] text-[#dc2626]">
                  Read Only بعد الاعتماد
                </Badge>
              ) : (
                <Badge className="border-[#86efac] bg-[#dcfce7] text-[#15803d]">
                  قابل للتعديل الحر
                </Badge>
              )}
            </div>

            {/* Four amounts — ADR-0025 */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  l: 'إجمالي الطلب',
                  v: selectedOrder.total,
                  box: 'bg-white',
                },
                {
                  l: 'تم تحصيله',
                  v: selectedOrder.collected,
                  box: 'bg-[#eff6ff]',
                },
                {
                  l: 'المتبقي',
                  v: selectedOrder.remaining,
                  box: selectedOrder.remaining > 0 ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-white',
                },
                {
                  l: 'حالة التحصيل',
                  v: null as number | null,
                  text: paymentLabel(selectedOrder.payment),
                  box: 'bg-[#fffbeb]',
                },
              ].map((x) => (
                <div
                  key={x.l}
                  className={cn(
                    wf.cardSoft,
                    'p-3 text-center',
                    x.box,
                  )}
                >
                  <p className="text-[11px] font-medium text-[#64748b]">{x.l}</p>
                  {x.v != null ? (
                    <p className="mt-1 text-xl font-bold" dir="ltr">
                      {money(x.v)}
                    </p>
                  ) : (
                    <p className="mt-1 text-base font-bold text-[#b45309]">
                      {x.text}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {/* Items */}
              <div className={cn(wf.card, 'p-4')}>
                <div className="mb-3 flex items-center gap-2">
                  <ShoppingBag className="size-4 text-[#3b82f6]" />
                  <h3 className="font-bold text-[#0f172a]">أصناف الطلب</h3>
                </div>
                <ul className="space-y-2">
                  {mockSummaryLines.map((line) => (
                    <li
                      key={line.name}
                      className="flex items-center justify-between rounded-xl bg-[#f8fafc] px-3 py-2.5 text-sm"
                    >
                      <span>
                        <strong className="text-[#0f172a]">{line.qty}×</strong>{' '}
                        {line.name}
                      </span>
                      <span className="font-semibold" dir="ltr">
                        {money(line.total)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-between border-t border-[#eef2f7] pt-3 text-sm font-bold">
                  <span>الإجمالي</span>
                  <span dir="ltr">{money(selectedOrder.total)}</span>
                </div>
              </div>

              {/* Customer + timeline */}
              <div className="space-y-3">
                <div className={cn(wf.card, 'p-4')}>
                  <h3 className="mb-2 font-bold text-[#0f172a]">العميل</h3>
                  <p className="text-sm">{selectedOrder.customer}</p>
                  {selectedOrder.type === 'delivery' ? (
                    <p className="mt-1 text-xs text-[#64748b]">
                      هاتف · عنوان الدليفري (من بيانات الطلب)
                    </p>
                  ) : null}
                </div>
                <div className={cn(wf.card, 'p-4')}>
                  <div className="mb-3 flex items-center gap-2">
                    <Clock3 className="size-4 text-[#64748b]" />
                    <h3 className="font-bold text-[#0f172a]">سجل الطلب</h3>
                  </div>
                  <ol className="space-y-2">
                    {mockTimeline.map((ev) => (
                      <li
                        key={ev.label}
                        className="border-s-2 border-[#3b82f6] ps-3 text-sm"
                      >
                        <p className="font-medium text-[#0f172a]">{ev.label}</p>
                        <p className="text-xs text-[#64748b]">{ev.at}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>

            {selectedOrder.payment === 'paid' ? (
              <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
                يوجد تحصيل معتمد — التعديل الحر غير مسموح. المسار الصحيح:{' '}
                <strong>Amend Order / Financial Delta</strong> (ADR-0024 /
                ADR-0025 / ADR-0026).
              </div>
            ) : null}
          </div>
        </OverlayShell>
      ) : null}

      {overlay === 'ops' || overlay === 'shift' ? (
        <OverlayShell
          title={overlay === 'shift' ? 'ملخص الوردية' : 'أدوات التشغيل'}
          onClose={() => setOverlay(null)}
        >
          {overlay === 'shift' ? (
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              <div className="flex justify-between">
                <span>مبيعات الوردية</span>
                <strong dir="ltr">2,450.00</strong>
              </div>
              <div className="flex justify-between">
                <span>تحصيلات معلّقة</span>
                <strong dir="ltr">380.00</strong>
              </div>
              <div className="flex justify-between">
                <span>رصيد الدرج</span>
                <strong dir="ltr">1,250.00</strong>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {[
                'ملخص الوردية',
                'اعتماد التحصيلات',
                'تحويل نقدي',
                'تحويل بين الخزن',
                'تسجيل مصروف',
              ].map((label) => (
                <TouchBtn
                  key={label}
                  className="w-full min-h-14 justify-start"
                  onClick={() => {
                    if (label.startsWith('ملخص')) setOverlay('shift')
                    else flash(`${label} — لاحقًا`)
                  }}
                >
                  {label}
                </TouchBtn>
              ))}
            </div>
          )}
        </OverlayShell>
      ) : null}
    </div>
  )
}

function SideNavBtn({
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
