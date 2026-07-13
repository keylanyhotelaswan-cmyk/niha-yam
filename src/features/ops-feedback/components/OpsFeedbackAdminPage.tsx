import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  addOpsFeedbackComment,
  getOpsFeedbackImageUrl,
  listOpsFeedbackAdmin,
  listOpsFeedbackComments,
  updateOpsFeedbackStatus,
  type OpsFeedbackRow,
  type OpsFeedbackStatus,
} from '@/features/ops-feedback/api/opsFeedback.api'
import { formatDateTime } from '@/features/treasury/utils/format'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

const STATUSES: Array<OpsFeedbackStatus | 'all'> = [
  'all',
  'new',
  'in_review',
  'resolved',
  'closed',
]

export function OpsFeedbackAdminPage() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<OpsFeedbackStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<OpsFeedbackRow | null>(null)

  const listQuery = useQuery({
    queryKey: ['ops-feedback', 'admin', status, search],
    queryFn: () =>
      listOpsFeedbackAdmin({
        status: status === 'all' ? null : status,
        search: search || undefined,
        limit: 80,
      }),
  })

  const rows = listQuery.data ?? []

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-[#0f172a]">
          {t.opsFeedback.adminTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{t.opsFeedback.adminHint}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.opsFeedback.search}
        />
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                status === s
                  ? 'border-[#93c5fd] bg-[#eff6ff] text-[#1d4ed8]'
                  : 'border-[#e2e8f0] text-[#475569]',
              )}
              onClick={() => setStatus(s)}
            >
              {t.opsFeedback.statuses[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t.opsFeedback.empty}</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelected(row)}
                className={cn(
                  'w-full rounded-2xl border bg-white p-3 text-right shadow-sm transition',
                  selected?.id === row.id
                    ? 'border-[#93c5fd] ring-2 ring-[#bfdbfe]'
                    : 'border-[#eef2f7]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#0f172a]">{row.title}</p>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {row.body}
                    </p>
                  </div>
                  <StatusChip status={row.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#64748b]">
                  <span>{row.reference}</span>
                  <span>{row.created_by_name}</span>
                  <span>{formatDateTime(row.created_at)}</span>
                  <span>{t.opsFeedback.kinds[row.kind]}</span>
                  <span>{t.opsFeedback.priorities[row.priority]}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {selected ? (
          <FeedbackDetail
            key={selected.id}
            row={selected}
            onUpdated={(next) => {
              setSelected(next)
              void queryClient.invalidateQueries({ queryKey: ['ops-feedback'] })
            }}
          />
        ) : (
          <div className="text-muted-foreground rounded-2xl border border-dashed border-[#e2e8f0] p-8 text-center text-sm">
            {t.opsFeedback.openDetail}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: OpsFeedbackStatus }) {
  return (
    <span className="shrink-0 rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-bold text-[#334155]">
      {t.opsFeedback.statuses[status]}
    </span>
  )
}

function FeedbackDetail({
  row,
  onUpdated,
}: {
  row: OpsFeedbackRow
  onUpdated: (row: OpsFeedbackRow) => void
}) {
  const [status, setStatus] = useState<OpsFeedbackStatus>(row.status)
  const [resolution, setResolution] = useState(row.resolution_note ?? '')
  const [version, setVersion] = useState(row.resolved_in_version ?? '')
  const [comment, setComment] = useState('')

  const commentsQuery = useQuery({
    queryKey: ['ops-feedback', 'comments', row.id],
    queryFn: () => listOpsFeedbackComments(row.id),
  })

  const imageQuery = useQuery({
    queryKey: ['ops-feedback', 'image', row.image_path],
    queryFn: () => getOpsFeedbackImageUrl(row.image_path!),
    enabled: Boolean(row.image_path),
  })

  const saveMut = useMutation({
    mutationFn: () =>
      updateOpsFeedbackStatus({
        id: row.id,
        status,
        resolutionNote: resolution,
        resolvedInVersion: version,
      }),
    onSuccess: () => {
      toast.success(t.opsFeedback.statusUpdated)
      onUpdated({
        ...row,
        status,
        resolution_note: resolution,
        resolved_in_version: version,
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const commentMut = useMutation({
    mutationFn: () => addOpsFeedbackComment(row.id, comment.trim()),
    onSuccess: () => {
      setComment('')
      void commentsQuery.refetch()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const meta = useMemo(
    () => [
      [t.opsFeedback.cashier, row.created_by_name],
      [t.opsFeedback.shift, row.shift_reference],
      [t.opsFeedback.when, formatDateTime(row.created_at)],
      [t.opsFeedback.device, row.device_label?.slice(0, 40)],
      [t.opsFeedback.appVersion, row.app_version],
      [t.opsFeedback.bridgeVersion, row.bridge_version],
      [
        t.opsFeedback.context,
        t.opsFeedback.contexts[
          (row.context_type ?? 'none') as keyof typeof t.opsFeedback.contexts
        ],
      ],
    ],
    [row],
  )

  return (
    <div className="space-y-4 rounded-2xl border border-[#eef2f7] bg-white p-4 shadow-sm">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-[#0f172a]">{row.title}</h2>
          <StatusChip status={row.status} />
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{row.reference}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm text-[#334155]">
          {row.body}
        </p>
      </div>

      {imageQuery.data ? (
        <img
          src={imageQuery.data}
          alt={t.opsFeedback.photoAlt}
          className="max-h-56 rounded-xl border object-contain"
        />
      ) : null}

      <dl className="grid grid-cols-2 gap-2 text-xs">
        {meta.map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-[#f8fafc] px-2 py-1.5">
            <dt className="text-[#94a3b8]">{k}</dt>
            <dd className="font-medium text-[#0f172a]">{v || '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2 border-t pt-3">
        <Label>{t.opsFeedback.filterStatus}</Label>
        <div className="flex flex-wrap gap-1">
          {(['new', 'in_review', 'resolved', 'closed'] as OpsFeedbackStatus[]).map(
            (s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs font-semibold',
                  status === s
                    ? 'border-[#93c5fd] bg-[#eff6ff] text-[#1d4ed8]'
                    : 'border-[#e2e8f0]',
                )}
                onClick={() => setStatus(s)}
              >
                {t.opsFeedback.statuses[s]}
              </button>
            ),
          )}
        </div>
        <Label>{t.opsFeedback.resolution}</Label>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={3}
          className="border-input w-full rounded-md border px-3 py-2 text-sm"
        />
        <Label>{t.opsFeedback.resolvedInVersion}</Label>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder={t.opsFeedback.resolvedInVersionHint}
        />
        <Button
          type="button"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {t.opsFeedback.saveStatus}
        </Button>
      </div>

      <div className="space-y-2 border-t pt-3">
        <Label>{t.opsFeedback.comments}</Label>
        <div className="space-y-2">
          {(commentsQuery.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t.opsFeedback.noComments}
            </p>
          ) : (
            (commentsQuery.data ?? []).map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-[#f8fafc] px-3 py-2 text-sm"
              >
                <p className="text-[11px] text-[#94a3b8]">
                  {c.created_by_name} · {formatDateTime(c.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))
          )}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t.opsFeedback.commentPlaceholder}
          rows={2}
          className="border-input w-full rounded-md border px-3 py-2 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!comment.trim() || commentMut.isPending}
          onClick={() => commentMut.mutate()}
        >
          {t.opsFeedback.addComment}
        </Button>
      </div>
    </div>
  )
}
