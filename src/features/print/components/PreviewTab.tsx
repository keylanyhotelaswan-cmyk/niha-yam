import { useState } from 'react'
import { kindLabel } from '@/features/print/components/print-labels'
import { usePrintPreview } from '@/features/print/hooks/usePrintQueries'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { t } from '@/shared/i18n'

const PREVIEW_KINDS = ['receipt', 'kitchen'] as const

export function PreviewTab() {
  const [kind, setKind] = useState<string>('receipt')
  const preview = usePrintPreview(kind)

  return (
    <Card>
      <CardHeader className="gap-4">
        <CardTitle>{t.print.preview.heading}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <label className="text-sm" htmlFor="preview-kind">
            {t.print.preview.pickKind}
          </label>
          <select
            id="preview-kind"
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {PREVIEW_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {preview.isLoading ? (
          <LoadingState />
        ) : preview.isError ? (
          <ErrorState
            description={t.print.preview.loadFailed}
            onRetry={() => void preview.refetch()}
          />
        ) : preview.data ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {preview.data.template.name} · v{preview.data.template.version}
            </p>
            <pre
              dir="rtl"
              className="bg-muted/40 overflow-x-auto rounded-md border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
            >
              {renderPreview(
                preview.data.template.body,
                preview.data.sample_data,
              )}
            </pre>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t.print.preview.empty}</p>
        )}
      </CardContent>
    </Card>
  )
}

function renderPreview(
  body: { blocks?: Array<Record<string, unknown>> },
  sample: Record<string, unknown>,
): string {
  const blocks = body.blocks ?? []
  const lines: string[] = []
  for (const block of blocks) {
    const type = String(block.type ?? '')
    if (type === 'line') {
      lines.push('--------------------------------')
      continue
    }
    if (type === 'cut') {
      lines.push('[قص]')
      continue
    }
    const key = typeof block.key === 'string' ? block.key : ''
    const value = sample[key]
    if (type === 'table' && Array.isArray(value)) {
      for (const row of value) {
        if (row && typeof row === 'object') {
          const r = row as Record<string, unknown>
          const name = String(r.name ?? '')
          const qty = r.qty != null ? `×${r.qty}` : ''
          const price =
            r.total != null
              ? String(r.total)
              : r.price != null
                ? String(r.price)
                : ''
          const mods = r.modifiers ? ` (${r.modifiers})` : ''
          const note = r.note ? ` — ${r.note}` : ''
          lines.push(`${qty} ${name}${mods}${note} ${price}`.trim())
        }
      }
      continue
    }
    if (Array.isArray(value)) {
      lines.push(
        value
          .map((v) =>
            v && typeof v === 'object'
              ? JSON.stringify(v)
              : String(v ?? ''),
          )
          .join(' · '),
      )
      continue
    }
    if (value != null && value !== '') {
      const prefix = block.bold ? '' : ''
      lines.push(`${prefix}${String(value)}`)
    } else if (key) {
      lines.push(`[${key}]`)
    }
  }
  return lines.join('\n')
}
