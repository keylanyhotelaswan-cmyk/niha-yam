import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPosSearch } from '@/features/orders/api/orders.api'
import { formatMoney } from '@/features/treasury/utils/format'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  query: string
  onSelectOrder: (id: string) => void
  onSelectCustomer: (customer: {
    id: string
    display_name: string
    primary_phone: string | null
  }) => void
  onSelectProduct: (item: { id: string; name: string }) => void
}

type SectionKey = 'customers' | 'orders' | 'menu_items'

/** Infer search intent so result sections are ordered by relevance. */
function detectSearchIntent(q: string): SectionKey[] {
  const trimmed = q.trim()
  const digits = trimmed.replace(/[\s\-()+]/g, '')
  if (/^\d{6,}$/.test(digits) || /^0\d{9,}$/.test(digits)) {
    return ['customers', 'orders', 'menu_items']
  }
  if (/^ord/i.test(trimmed) || /طلب/i.test(trimmed)) {
    return ['orders', 'customers', 'menu_items']
  }
  // SKU-like or product-ish tokens
  if (/^[A-Za-z0-9\-_]{2,}$/.test(trimmed) && /[A-Za-z]/.test(trimmed)) {
    return ['menu_items', 'orders', 'customers']
  }
  // Arabic / name text → customers first, then products, then orders
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    return ['customers', 'menu_items', 'orders']
  }
  return ['orders', 'customers', 'menu_items']
}

export function PosSearchResults({
  query,
  onSelectOrder,
  onSelectCustomer,
  onSelectProduct,
}: Props) {
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const searchQuery = useQuery({
    queryKey: ['pos', 'search', debounced],
    queryFn: () => fetchPosSearch(debounced),
    enabled: debounced.trim().length >= 2,
  })

  const order = useMemo(
    () => detectSearchIntent(debounced),
    [debounced],
  )

  if (debounced.trim().length < 2) return null

  const data = searchQuery.data
  const empty =
    !searchQuery.isLoading &&
    !data?.orders?.length &&
    !data?.customers?.length &&
    !data?.menu_items?.length

  const sections = order
    .map((key) => {
      if (key === 'orders' && data?.orders?.length) {
        return (
          <Section key="orders" title={t.pos.search.orders} primary>
            {data.orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className={resultBtn}
                onClick={() => onSelectOrder(o.id)}
              >
                <span dir="ltr" className="font-semibold">
                  {o.reference}
                </span>
                <span className="text-[#64748b]">
                  {o.customer_name || '—'} · {formatMoney(o.total)}
                </span>
              </button>
            ))}
          </Section>
        )
      }
      if (key === 'customers' && data?.customers?.length) {
        return (
          <Section key="customers" title={t.pos.search.customers} primary>
            {data.customers.map((c) => (
              <button
                key={c.id}
                type="button"
                className={resultBtn}
                onClick={() => onSelectCustomer(c)}
              >
                <span className="font-semibold">{c.display_name}</span>
                {c.primary_phone ? (
                  <span className="text-[#64748b]" dir="ltr">
                    {c.primary_phone}
                  </span>
                ) : null}
              </button>
            ))}
          </Section>
        )
      }
      if (key === 'menu_items' && data?.menu_items?.length) {
        return (
          <Section key="menu_items" title={t.pos.search.products} primary>
            {data.menu_items.map((m) => (
              <button
                key={m.id}
                type="button"
                className={resultBtn}
                onClick={() => onSelectProduct(m)}
              >
                <span className="font-semibold">{m.name}</span>
                <span className="text-[#64748b]" dir="ltr">
                  {m.sku ? `${m.sku} · ` : ''}
                  {formatMoney(m.base_price)}
                </span>
              </button>
            ))}
          </Section>
        )
      }
      return null
    })
    .filter(Boolean)

  return (
    <div className="rounded-xl border border-[#93c5fd] bg-white p-3 shadow-[0_4px_16px_rgba(59,130,246,0.12)]">
      {searchQuery.isLoading ? (
        <p className="text-sm text-[#64748b]">{t.common.loading}</p>
      ) : empty ? (
        <p className="text-sm text-[#64748b]">{t.pos.search.empty}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">{sections}</div>
      )}
    </div>
  )
}

const resultBtn = cn(
  'flex min-h-11 w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-[#eff6ff]',
)

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
  primary?: boolean
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold tracking-wide text-[#64748b]">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}
