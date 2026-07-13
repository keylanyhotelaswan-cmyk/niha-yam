import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  disabled?: boolean
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const

export function PinPad({ value, onChange, onSubmit, disabled }: Props) {
  function press(key: (typeof KEYS)[number]) {
    if (disabled) return
    if (key === 'clear') {
      onChange('')
      return
    }
    if (key === 'back') {
      onChange(value.slice(0, -1))
      return
    }
    if (value.length >= 6) return
    onChange(value + key)
  }

  return (
    <div className="space-y-3">
      <div
        className="bg-muted flex h-12 items-center justify-center rounded-md font-mono text-2xl tracking-[0.3em]"
        dir="ltr"
        aria-live="polite"
      >
        {value ? '•'.repeat(value.length) : '—'}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant={key === 'clear' ? 'outline' : 'secondary'}
            className={cn('h-14 text-lg', key === 'back' && 'text-base')}
            disabled={disabled}
            onClick={() => press(key)}
          >
            {key === 'clear' ? 'مسح' : key === 'back' ? '⌫' : key}
          </Button>
        ))}
      </div>
      <Button
        className="h-12 w-full text-base"
        type="button"
        disabled={disabled || value.length < 4}
        onClick={onSubmit}
      >
        {t.pos.pin.submit}
      </Button>
    </div>
  )
}
