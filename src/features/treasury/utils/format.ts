import { t } from '@/shared/i18n'

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Latin-digit money with the EGP label — POS-friendly and unambiguous. */
export function formatMoney(value: number | null | undefined): string {
  return `${money.format(value ?? 0)} ${t.treasury.currency}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return t.treasury.common.none
  return dateTime.format(new Date(value))
}
