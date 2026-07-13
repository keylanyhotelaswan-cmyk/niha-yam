import { z } from 'zod'
import { t } from '@/shared/i18n'

const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, t.validation.usernameFormat)

const passwordField = z.string().min(8, t.validation.passwordMin)

const pinField = z.string().regex(/^\d{4,6}$/, t.validation.pinFormat)

const roleField = z.enum([
  'owner',
  'manager',
  'cashier',
  'remote_operator',
  'waiter',
  'kitchen',
])

/** Create: name, username, password, optional PIN, role, status — one dialog. */
export const createStaffSchema = z.object({
  displayName: z.string().trim().min(2, t.validation.nameMin),
  username: usernameField,
  password: passwordField,
  pin: z.union([z.literal(''), pinField]).optional(),
  role: roleField,
  isActive: z.boolean(),
})

export type CreateStaffFormValues = z.infer<typeof createStaffSchema>

/** Edit: name + role only (username immutable; status via a separate action). */
export const editStaffSchema = z.object({
  displayName: z.string().trim().min(2, t.validation.nameMin),
  role: roleField,
})

export type EditStaffFormValues = z.infer<typeof editStaffSchema>

export const setPinSchema = z.object({
  pin: pinField,
})

export type SetPinFormValues = z.infer<typeof setPinSchema>

export const changePasswordSchema = z.object({
  password: passwordField,
})

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
