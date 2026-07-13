import { Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/utils/cn'

/** Top-level section with an anchor id for in-page navigation. */
export function DocSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** Uniform documentation card for a single component. */
export function ComponentDoc({
  name,
  purpose,
  whenToUse,
  whenNotToUse,
  children,
}: {
  name: string
  purpose: ReactNode
  whenToUse: ReactNode[]
  whenNotToUse: ReactNode[]
  children: ReactNode
}) {
  return (
    <article className="bg-card space-y-6 rounded-lg border p-6">
      <header className="space-y-2">
        <h3 className="font-mono text-base font-semibold">{name}</h3>
        <p className="text-muted-foreground text-sm">{purpose}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <UsageList tone="use" title="متى يُستخدم" items={whenToUse} />
        <UsageList tone="avoid" title="متى لا يُستخدم" items={whenNotToUse} />
      </div>

      {children}
    </article>
  )
}

function UsageList({
  tone,
  title,
  items,
}: {
  tone: 'use' | 'avoid'
  title: string
  items: ReactNode[]
}) {
  const Icon = tone === 'use' ? Check : X
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm">
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                tone === 'use' ? 'text-success' : 'text-destructive',
              )}
              aria-hidden
            />
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Labeled preview surface for rendering live component instances. */
export function Preview({
  label,
  children,
  className,
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className="space-y-2">
      {label ? (
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
      ) : null}
      <div
        className={cn(
          'bg-background flex flex-wrap items-center gap-3 rounded-md border p-4',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Grid of named states/variants, each with its own preview. */
export function StatesGrid({
  items,
}: {
  items: { label: string; node: ReactNode }[]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            {item.label}
          </p>
          <div className="bg-background flex min-h-16 items-center justify-center rounded-md border p-3">
            {item.node}
          </div>
        </div>
      ))}
    </div>
  )
}

export type PropRow = {
  name: string
  type: string
  default?: string
  description: string
}

/** Props reference table. */
export function PropsTable({ rows }: { rows: PropRow[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">الخصائص (Props)</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start font-medium">الاسم</th>
              <th className="px-3 py-2 text-start font-medium">النوع</th>
              <th className="px-3 py-2 text-start font-medium">الافتراضي</th>
              <th className="px-3 py-2 text-start font-medium">الوصف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{row.name}</td>
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                  {row.type}
                </td>
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                  {row.default ?? '—'}
                </td>
                <td className="text-muted-foreground px-3 py-2">
                  {row.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Code snippet block (proposed/example usage — not executed). */
export function UsageExample({
  title = 'مثال الاستخدام',
  code,
}: {
  title?: string
  code: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <pre
        className="bg-muted overflow-x-auto rounded-md p-4 text-left text-xs"
        dir="ltr"
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Side-by-side correct vs incorrect usage. */
export function DoDont({
  doCode,
  dontCode,
  doNote,
  dontNote,
}: {
  doCode: string
  dontCode: string
  doNote?: string
  dontNote?: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="border-success/40 space-y-2 rounded-md border p-3">
        <p className="text-success flex items-center gap-1.5 text-sm font-medium">
          <Check className="size-4" aria-hidden /> صحيح
        </p>
        {doNote ? (
          <p className="text-muted-foreground text-xs">{doNote}</p>
        ) : null}
        <pre
          className="bg-muted overflow-x-auto rounded-md p-3 text-left text-xs"
          dir="ltr"
        >
          <code>{doCode}</code>
        </pre>
      </div>
      <div className="border-destructive/40 space-y-2 rounded-md border p-3">
        <p className="text-destructive flex items-center gap-1.5 text-sm font-medium">
          <X className="size-4" aria-hidden /> خاطئ
        </p>
        {dontNote ? (
          <p className="text-muted-foreground text-xs">{dontNote}</p>
        ) : null}
        <pre
          className="bg-muted overflow-x-auto rounded-md p-3 text-left text-xs"
          dir="ltr"
        >
          <code>{dontCode}</code>
        </pre>
      </div>
    </div>
  )
}

/** Color token swatch. */
export function Swatch({
  name,
  className,
}: {
  name: string
  className: string
}) {
  return (
    <div className="space-y-1.5">
      <div className={cn('h-14 rounded-md border', className)} />
      <p className="font-mono text-xs">{name}</p>
    </div>
  )
}
