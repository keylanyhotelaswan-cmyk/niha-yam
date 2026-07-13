import { DocSection, Swatch } from './doc-kit'

const colorTokens = [
  { name: 'background', className: 'bg-background' },
  { name: 'foreground', className: 'bg-foreground' },
  { name: 'card', className: 'bg-card' },
  { name: 'primary', className: 'bg-primary' },
  { name: 'secondary', className: 'bg-secondary' },
  { name: 'muted', className: 'bg-muted' },
  { name: 'accent', className: 'bg-accent' },
  { name: 'destructive', className: 'bg-destructive' },
  { name: 'success', className: 'bg-success' },
  { name: 'warning', className: 'bg-warning' },
  { name: 'info', className: 'bg-info' },
  { name: 'border', className: 'bg-border' },
  { name: 'sidebar', className: 'bg-sidebar' },
  { name: 'sidebar-accent', className: 'bg-sidebar-accent' },
]

const radii = [
  { name: 'rounded-sm', className: 'rounded-sm' },
  { name: 'rounded-md', className: 'rounded-md' },
  { name: 'rounded-lg', className: 'rounded-lg' },
  { name: 'rounded-xl', className: 'rounded-xl' },
]

const shadows = [
  { name: 'shadow-sm', className: 'shadow-sm' },
  { name: 'shadow-md', className: 'shadow-md' },
  { name: 'shadow-lg', className: 'shadow-lg' },
]

const typeScale = [
  { name: 'text-3xl', className: 'text-3xl font-bold' },
  { name: 'text-2xl', className: 'text-2xl font-bold' },
  { name: 'text-xl', className: 'text-xl font-semibold' },
  { name: 'text-lg', className: 'text-lg font-semibold' },
  { name: 'text-base', className: 'text-base' },
  { name: 'text-sm', className: 'text-sm' },
  { name: 'text-xs', className: 'text-xs' },
]

export function FoundationsSection() {
  return (
    <DocSection
      id="foundations"
      title="الأساسيات (Design Tokens)"
      description="القيم البصرية الوحيدة المسموح باستخدامها داخل المكوّنات (ADR-0003 / ADR-0006)."
    >
      <div className="space-y-3">
        <p className="text-sm font-medium">الألوان</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {colorTokens.map((token) => (
            <Swatch
              key={token.name}
              name={token.name}
              className={token.className}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">الطباعة (IBM Plex Sans Arabic)</p>
        <div className="bg-card space-y-2 rounded-lg border p-6">
          {typeScale.map((item) => (
            <div
              key={item.name}
              className="flex items-baseline justify-between gap-4"
            >
              <span className={item.className}>نظام نقاط البيع نيها</span>
              <span className="text-muted-foreground font-mono text-xs">
                {item.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-medium">نصف القطر (Radius)</p>
          <div className="flex flex-wrap gap-4">
            {radii.map((item) => (
              <div key={item.name} className="space-y-1.5 text-center">
                <div className={`bg-primary size-16 ${item.className}`} />
                <p className="font-mono text-xs">{item.name}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">الظلال (Elevation)</p>
          <div className="flex flex-wrap gap-4">
            {shadows.map((item) => (
              <div key={item.name} className="space-y-1.5 text-center">
                <div
                  className={`bg-card size-16 rounded-lg ${item.className}`}
                />
                <p className="font-mono text-xs">{item.name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DocSection>
  )
}
