import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { fetchCustomerProfile } from '@/features/customers/api/customers.api'
import { formatMoney } from '@/features/treasury/utils/format'
import { t } from '@/shared/i18n'

type Props = {
  customerId: string | null
  onClose: () => void
  onSelectOrder?: (orderId: string) => void
}

export function CustomerProfileDrawer({
  customerId,
  onClose,
  onSelectOrder,
}: Props) {
  const profileQuery = useQuery({
    queryKey: ['customers', 'profile', customerId],
    queryFn: () => fetchCustomerProfile(customerId!),
    enabled: Boolean(customerId),
  })

  const profile = profileQuery.data
  const lastOrder = profile?.recent_orders?.[0] ?? null
  const openOrder = profile?.open_order ?? null
  const lastVisit =
    profile?.last_order_at ?? lastOrder?.created_at ?? null

  return (
    <Dialog
      open={customerId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{t.customers.profile.title}</DialogTitle>
        </DialogHeader>

        {profileQuery.isLoading ? (
          <p className="text-sm text-[#64748b]">{t.common.loading}</p>
        ) : profile ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xl font-bold">{profile.display_name}</p>
              {profile.phones[0]?.phone_raw ? (
                <p className="text-base text-[#64748b]" dir="ltr">
                  {profile.phones[0].phone_raw}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat
                label={t.customers.profile.orderCount}
                value={String(profile.order_count)}
              />
              <Stat
                label={t.customers.profile.totalSpend}
                value={formatMoney(profile.total_purchases)}
              />
              <Stat
                label={t.customers.profile.lastOrder}
                value={lastOrder?.reference ?? '—'}
              />
              <Stat
                label={t.customers.profile.lastVisit}
                value={
                  lastVisit
                    ? new Date(lastVisit).toLocaleDateString('ar-EG')
                    : '—'
                }
              />
            </div>

            {openOrder ? (
              <button
                type="button"
                className="w-full rounded-2xl border border-[#86efac] bg-[#dcfce7] px-4 py-3 text-start"
                onClick={() => onSelectOrder?.(openOrder.id)}
              >
                <p className="text-xs font-semibold text-[#15803d]">
                  {t.customers.profile.openOrder}
                </p>
                <p className="text-base font-bold" dir="ltr">
                  {openOrder.reference} · {formatMoney(openOrder.total)}
                </p>
              </button>
            ) : (
              <p className="rounded-2xl bg-[#f8fafc] px-4 py-3 text-xs text-[#64748b]">
                {t.customers.profile.noOpenOrder}
              </p>
            )}

            {profile.addresses.length > 0 ? (
              <section>
                <p className="mb-2 font-semibold">
                  {t.customers.profile.addresses}
                </p>
                <ul className="space-y-1">
                  {profile.addresses.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl bg-[#f8fafc] px-3 py-2.5 text-sm"
                    >
                      {a.address_line}
                      {a.delivery_zone ? ` · ${a.delivery_zone}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {profile.notes ? (
              <p className="rounded-xl bg-[#fffbeb] px-3 py-2.5 text-sm text-[#92400e]">
                {profile.notes}
              </p>
            ) : null}

            {profile.recent_orders.length > 0 ? (
              <section>
                <p className="mb-2 font-semibold">
                  {t.customers.profile.recentOrders}
                </p>
                <ul className="space-y-1">
                  {profile.recent_orders.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center justify-between rounded-xl border border-[#eef2f7] px-3 py-2.5 text-start hover:bg-[#f8fafc]"
                        onClick={() => onSelectOrder?.(o.id)}
                      >
                        <span dir="ltr" className="font-semibold">
                          {o.reference}
                        </span>
                        <span dir="ltr">{formatMoney(o.total)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f8fafc] p-3">
      <p className="text-xs text-[#64748b]">{label}</p>
      <p className="text-base font-bold" dir="ltr">
        {value}
      </p>
    </div>
  )
}
