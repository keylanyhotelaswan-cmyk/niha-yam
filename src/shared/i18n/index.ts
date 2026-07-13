import { common } from './ar/common'
import { auth } from './ar/auth'
import { staff } from './ar/staff'
import { menu } from './ar/menu'
import { treasury } from './ar/treasury'
import { pos } from './ar/pos'
import { orders } from './ar/orders'
import { customers } from './ar/customers'
import { drivers } from './ar/drivers'
import { shell } from './ar/shell'
import { errors } from './ar/errors'
import { validation } from './ar/validation'
import { patterns } from './ar/patterns'
import { print } from './ar/print'
import { reports } from './ar/reports'
import { recipes } from './ar/recipes'
import { inventory } from './ar/inventory'
import { callCenter } from './ar/callCenter'
import { opsMessages } from './ar/opsMessages'
import { opsFeedback } from './ar/opsFeedback'

/**
 * Arabic message catalog — the single source of user-facing copy for U1.
 * No i18n library yet (Arabic-only); see docs/adr/0002-arabic-first-rtl.md.
 * To add a locale later, introduce a keyed catalog + library and reuse these keys.
 */
export const ar = {
  common,
  auth,
  staff,
  menu,
  treasury,
  pos,
  orders,
  customers,
  drivers,
  print,
  reports,
  recipes,
  inventory,
  callCenter,
  opsMessages,
  opsFeedback,
  shell,
  errors,
  validation,
  patterns,
} as const

/** Active message catalog. Import as `import { t } from '@/shared/i18n'`. */
export const t = ar

export type Messages = typeof ar
