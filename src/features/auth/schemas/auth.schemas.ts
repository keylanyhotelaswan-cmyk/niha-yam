import { z } from 'zod'
import { t } from '@/shared/i18n'

export const loginSchema = z.object({
  username: z.string().min(1, t.validation.required),
  password: z.string().min(1, t.validation.required),
})

export type LoginFormValues = z.infer<typeof loginSchema>
