import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  acknowledgeOpsMessage,
  listOpsMessages,
  sendOpsMessage,
} from '@/features/ops-messages/api/opsMessages.api'
import { formatDateTime } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/i18n'

const TARGETS = ['cashier', 'kitchen', 'remote_operator', 'all'] as const

export function OpsMessagesPanel() {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [targetRole, setTargetRole] =
    useState<(typeof TARGETS)[number]>('cashier')
  const [print, setPrint] = useState(false)

  const listQuery = useQuery({
    queryKey: ['ops-messages', 'list'],
    queryFn: () => listOpsMessages(40),
  })

  const sendMut = useMutation({
    mutationFn: () =>
      sendOpsMessage({ body: body.trim(), targetRole, print }),
    onSuccess: () => {
      toast.success(t.opsMessages.sent)
      setBody('')
      setPrint(false)
      void queryClient.invalidateQueries({ queryKey: ['ops-messages'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const ackMut = useMutation({
    mutationFn: (id: string) => acknowledgeOpsMessage(id),
    onSuccess: () => {
      toast.success(t.opsMessages.acknowledged)
      void queryClient.invalidateQueries({ queryKey: ['ops-messages'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">{t.opsMessages.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ops-body">{t.opsMessages.body}</Label>
          <textarea
            id="ops-body"
            className="border-input bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm"
            placeholder={t.opsMessages.bodyPlaceholder}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ops-target">{t.opsMessages.targetRole}</Label>
          <select
            id="ops-target"
            className="border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm"
            value={targetRole}
            onChange={(e) =>
              setTargetRole(e.target.value as (typeof TARGETS)[number])
            }
          >
            {TARGETS.map((role) => (
              <option key={role} value={role}>
                {t.opsMessages.roles[role]}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={print}
            onChange={(e) => setPrint(e.target.checked)}
          />
          {t.opsMessages.print}
        </label>
        <Button
          type="button"
          disabled={!body.trim() || sendMut.isPending}
          loading={sendMut.isPending}
          onClick={() => sendMut.mutate()}
        >
          {t.opsMessages.send}
        </Button>

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-semibold">{t.opsMessages.list}</p>
          {listQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">{t.common.loading}</p>
          ) : (listQuery.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.opsMessages.empty}</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {(listQuery.data ?? []).map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg border bg-[#f8fafc] p-3 space-y-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold" dir="ltr">
                      {m.reference}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(m.created_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="text-muted-foreground text-xs">
                    {t.opsMessages.by}: {m.created_by_name ?? '—'}
                    {m.target_role ? ` · ${m.target_role}` : null}
                  </p>
                  {m.acknowledged_at ? (
                    <p className="text-xs text-[#15803d]">
                      {t.opsMessages.acknowledged} ·{' '}
                      {formatDateTime(m.acknowledged_at)}
                    </p>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={ackMut.isPending}
                      onClick={() => ackMut.mutate(m.id)}
                    >
                      {t.opsMessages.acknowledge}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
