import { z } from 'zod'
import { t } from '@/shared/i18n'

const nameField = z.string().trim().min(1, t.menu.errors.INVALID_NAME)

const sortOrderField = z.number().int().min(0)

/** Category: name, sort order, POS visibility, active. */
export const categorySchema = z.object({
  name: nameField,
  sortOrder: sortOrderField,
  showInPos: z.boolean(),
  isActive: z.boolean(),
})

export type CategoryFormValues = z.infer<typeof categorySchema>

/** Item: operational flags per ADR-0020. Category conditionally required (S6). */
export const itemSchema = z
  .object({
    name: nameField,
    categoryId: z.string().uuid().nullable(),
    sku: z.string().trim().max(64).optional(),
    basePrice: z.number().min(0, t.menu.errors.INVALID_PRICE),
    sortOrder: sortOrderField,
    showInPos: z.boolean(),
    needsKitchen: z.boolean(),
    needsPrint: z.boolean(),
    acceptsModifiers: z.boolean(),
    allowsDiscounts: z.boolean(),
    isOpenPrice: z.boolean(),
    isFavorite: z.boolean(),
    description: z.string().trim().optional(),
  })
  .refine((v) => !v.showInPos || v.categoryId !== null, {
    // S6: an item visible in POS must have a category.
    message: t.menu.errors.POS_REQUIRES_CATEGORY,
    path: ['categoryId'],
  })

export type ItemFormValues = z.infer<typeof itemSchema>

/** Modifier group: name + selection range (max 0 = unlimited). */
export const modifierGroupSchema = z
  .object({
    name: nameField,
    minSelections: z.number().int().min(0),
    maxSelections: z.number().int().min(0),
    sortOrder: sortOrderField,
    isActive: z.boolean(),
  })
  .refine((v) => v.maxSelections === 0 || v.maxSelections >= v.minSelections, {
    message: t.menu.errors.INVALID_SELECTION_RANGE,
    path: ['maxSelections'],
  })

export type ModifierGroupFormValues = z.infer<typeof modifierGroupSchema>

/** Modifier option: name + price delta (can be zero/negative). */
export const modifierOptionSchema = z.object({
  name: nameField,
  priceDelta: z.number(),
  sortOrder: sortOrderField,
  isDefault: z.boolean(),
  isActive: z.boolean(),
})

export type ModifierOptionFormValues = z.infer<typeof modifierOptionSchema>
