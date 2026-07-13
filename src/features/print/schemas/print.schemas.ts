import { z } from 'zod'
import { t } from '@/shared/i18n'

export const printerSchema = z
  .object({
    name: z.string().trim().min(1, t.validation.required),
    role: z.enum(['cashier', 'kitchen', 'label', 'barcode']),
    connection: z.enum(['windows_spooler', 'lan_9100', 'usb', 'bluetooth']),
    bridgeId: z.union([z.string().uuid(), z.literal('')]),
    windowsPrinterName: z.string().trim(),
    address: z.string().trim(),
    paperWidthMm: z.preprocess(
      (v) => (Number(v) === 58 ? 58 : 80),
      z.union([z.literal(58), z.literal(80)]),
    ),
    encoding: z.string().trim().min(1, t.validation.required),
    defaultCopies: z.coerce.number().int().min(1).max(5),
    autoCut: z.boolean(),
    openCashDrawer: z.boolean(),
    logoUrl: z.string().trim(),
    footerText: z.string().trim(),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int(),
  })
  .superRefine((values, ctx) => {
    if (values.connection === 'windows_spooler') {
      if (!values.bridgeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bridgeId'],
          message: t.validation.required,
        })
      }
      if (!values.windowsPrinterName.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windowsPrinterName'],
          message: t.validation.required,
        })
      }
    } else if (!values.address.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: t.validation.required,
      })
    }
  })

export type PrinterFormValues = z.infer<typeof printerSchema>

export const printSettingsSchema = z.object({
  printJobTtlMinutes: z.union([
    z.literal(0),
    z.literal(2),
    z.literal(5),
    z.literal(10),
  ]),
  defaultCopies: z.coerce.number().int().min(1).max(5),
  paperWidthMm: z.preprocess(
    (v) => (Number(v) === 58 ? 58 : 80),
    z.union([z.literal(58), z.literal(80)]),
  ),
  openCashDrawer: z.boolean(),
  autoCut: z.boolean(),
  showQrOnReceipt: z.boolean(),
  thankYouMessage: z.string().trim(),
  receiptSlogan: z.string().trim(),
  restaurantPhone: z.string().trim(),
  restaurantAddress: z.string().trim(),
  fontTitlePt: z.coerce.number().int().min(14).max(40),
  fontBodyPt: z.coerce.number().int().min(12).max(32),
  fontTotalPt: z.coerce.number().int().min(14).max(40),
})

export type PrintSettingsFormValues = z.infer<typeof printSettingsSchema>

export const cancelReasonSchema = z.object({
  reason: z.string().trim().min(1, t.validation.required),
})

export type CancelReasonFormValues = z.infer<typeof cancelReasonSchema>
