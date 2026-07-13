import { z } from 'zod'
import { t } from '@/shared/i18n'

const amountField = z.number().positive(t.treasury.errors.INVALID_AMOUNT)
const nonNegativeAmount = z.number().min(0, t.treasury.errors.INVALID_AMOUNT)
const nameField = z.string().trim().min(1, t.treasury.errors.INVALID_NAME)
const sortOrderField = z.number().int().min(0)

export const openShiftSchema = z.object({
  openingFloat: nonNegativeAmount,
  /** Required when receiving a next-shift handover (Path B). */
  receivedActualCash: z.number().optional(),
})
export type OpenShiftFormValues = z.infer<typeof openShiftSchema>

export const closeShiftSchema = z.object({
  actualCashCount: nonNegativeAmount,
  differenceReason: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  destination: z.enum(['to_main', 'to_next_shift']).optional(),
})
export type CloseShiftFormValues = z.infer<typeof closeShiftSchema>

export const cashDropSchema = z.object({
  amount: amountField,
  reason: z.string().trim().optional(),
})
export type CashDropFormValues = z.infer<typeof cashDropSchema>

export const transferSchema = z
  .object({
    sourceTreasuryId: z.string().uuid(),
    destTreasuryId: z.string().uuid(),
    amount: amountField,
    reason: z.string().trim().optional(),
  })
  .refine((v) => v.sourceTreasuryId !== v.destTreasuryId, {
    message: t.treasury.errors.SAME_TREASURY,
    path: ['destTreasuryId'],
  })
export type TransferFormValues = z.infer<typeof transferSchema>

export const expenseSchema = z.object({
  treasuryId: z.string().uuid(),
  category: z.enum([
    'petty_cash',
    'supplies',
    'utilities',
    'salary',
    'rent',
    'maintenance',
    'other',
  ]),
  amount: amountField,
  description: z.string().trim().optional(),
  vendor: z.string().trim().optional(),
})
export type ExpenseFormValues = z.infer<typeof expenseSchema>

export const adjustmentSchema = z.object({
  treasuryId: z.string().uuid(),
  amount: amountField,
  reason: z.string().trim().optional(),
})
export type AdjustmentFormValues = z.infer<typeof adjustmentSchema>

export const treasurySchema = z.object({
  name: nameField,
  type: z.enum(['cash', 'digital', 'bank']),
  sortOrder: sortOrderField,
})
export type TreasuryFormValues = z.infer<typeof treasurySchema>

export const reasonSchema = z.object({
  reason: z.string().trim().min(1, t.treasury.errors.REASON_REQUIRED),
})
export type ReasonFormValues = z.infer<typeof reasonSchema>
