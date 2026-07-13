import { t } from '@/shared/i18n'

export function PosPlaceholderPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">{t.shell.posPlaceholder.title}</h1>
      <p className="text-muted-foreground text-sm">
        {t.shell.posPlaceholder.body}
      </p>
    </div>
  )
}
