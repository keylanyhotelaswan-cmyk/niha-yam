import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  collectRemaining,
  rejectCollection,
} from '@/features/orders/api/orders.api'
import type { OrderCollection, OrderMoney } from '@/features/orders/types'
import { formatMoney } from '@/features/treasury/utils/format'
import { t } from '@/shared/i18n'

type Props = {
  orderId: string
  money: OrderMoney
  collections: OrderCollection[]
  paymentMethods: Array<{ id: string; name: string; code: string }>
  onUpdated: () => void
}

export function FinancialAdjustPanel({
  orderId,
  money,
  collections,
  paymentMethods,
  onUpdated,
}: Props) {
  const [reverseId, setReverseId] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [collectAmount, setCollectAmount] = useState('')
  const [collectMethodId, setCollectMethodId] = useState(
    paymentMethods[0]?.id ?? '',
  )

  const reversible = collections.filter(
    (c) => c.collection_status === 'approved',
  )
  const cashPm = paymentMethods.find((p) => p.code === 'cash') ?? paymentMethods[0]

  const reverseMut = useMutation({
    mutationFn: () => rejectCollection(reverseId!, reverseReason.trim()),
    onSuccess: () => {
      toast.success(t.orders.financial.reversed)
      setReverseId(null)
      setReverseReason('')
      onUpdated()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const collectMut = useMutation({
    mutationFn: () =>
      collectRemaining(orderId, [
        {
          payment_method_id: collectMethodId || cashPm!.id,
          amount: Number(collectAmount) || money.remaining_amount,
        },
      ]),
    onSuccess: () => {
      toast.success(t.orders.hub.collectRemaining)
      setCollectAmount('')
      onUpdated()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-4 text-sm">
      <p className="mb-2 font-bold text-[#92400e]">{t.orders.financial.title}</p>
      <p className="mb-3 text-xs text-[#b45309]">{t.orders.financial.hint}</p>

      {money.over_collected_amount > 0.001 ? (
        <p className="mb-3 rounded-xl bg-[#fef2f2] px-3 py-2 text-xs text-[#b91c1c]">
          {t.orders.financial.overCollected}:{' '}
          <strong dir="ltr">{formatMoney(money.over_collected_amount)}</strong>
        </p>
      ) : null}

      {money.remaining_amount > 0.001 ? (
        <div className="mb-3 space-y-2">
          <p className="font-semibold">{t.orders.hub.collectRemaining}</p>
          <select
            className="h-10 w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm"
            value={collectMethodId}
            onChange={(e) => setCollectMethodId(e.target.value)}
          >
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Input
            className="h-10 rounded-xl"
            type="number"
            placeholder={String(money.remaining_amount)}
            value={collectAmount}
            onChange={(e) => setCollectAmount(e.target.value)}
            dir="ltr"
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={collectMut.isPending}
            onClick={() => collectMut.mutate()}
          >
            {t.orders.hub.collectRemaining}
          </Button>
        </div>
      ) : null}

      {reversible.length > 0 ? (
        <div className="space-y-2">
          <p className="font-semibold">{t.orders.financial.reverse}</p>
          {reversible.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fde68a] bg-white px-3 py-2"
            >
              <div>
                <p className="font-medium" dir="ltr">
                  {formatMoney(c.amount)}
                </p>
                <p className="text-xs text-[#64748b]" dir="ltr">
                  {c.reference}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReverseId(c.id)}
              >
                {t.orders.financial.reverseAction}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {reverseId ? (
        <div className="mt-3 space-y-2 border-t border-[#fde68a] pt-3">
          <Input
            placeholder={t.orders.financial.reverseReason}
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setReverseId(null)
                setReverseReason('')
              }}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!reverseReason.trim() || reverseMut.isPending}
              onClick={() => reverseMut.mutate()}
            >
              {t.orders.financial.reverseAction}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
