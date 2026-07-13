/** Preview scenarios for Print Center layout editor — cover every printable field. */

export type PreviewScenarioId =
  | 'receipt_delivery'
  | 'receipt_dine_in'
  | 'receipt_takeaway'
  | 'kitchen_full'

export type PreviewScenario = {
  id: PreviewScenarioId
  documentType: 'receipt' | 'kitchen'
  labelKey: string
  descriptionKey: string
  snapshot: Record<string, unknown>
}

function brandingBase(branding?: {
  restaurant_name?: string | null
  slogan?: string | null
  restaurant_phone?: string | null
  restaurant_address?: string | null
  thank_you?: string | null
  show_qr?: boolean
  currency_label?: string | null
}) {
  return {
    restaurant_name: branding?.restaurant_name?.trim() || 'نيها يم',
    slogan:
      branding?.slogan?.trim() || 'من أول لقمة ... والباقي إدمان',
    restaurant_phone: branding?.restaurant_phone?.trim() || '01107666987',
    restaurant_address:
      branding?.restaurant_address?.trim() ||
      'أسوان - الشارع الجديد - أمام سلم فندق الكيلاني',
    thank_you: branding?.thank_you?.trim() || 'شكراً لزيارتكم',
    show_qr: branding?.show_qr ?? true,
    currency_label: branding?.currency_label?.trim() || 'ج.م',
    datetime: '2026/07/11 12:05:33 م',
    cashier: 'إبراهيم',
  }
}

export function buildScenarioSnapshot(
  id: PreviewScenarioId,
  branding?: Parameters<typeof brandingBase>[0],
): Record<string, unknown> {
  const b = brandingBase(branding)

  if (id === 'kitchen_full') {
    return {
      ...b,
      order_reference: 'ORD-000128',
      order_type_ar: 'دليفري',
      table_ref: null,
      customer_name: 'محمود علي',
      kitchen_ticket: 'KT-000087',
      order_note: 'توصيل سريع — بدون بصل — اتصال قبل الوصول',
      lines: [
        {
          name: 'ترياكي دجاج',
          quantity: 2,
          modifiers: ['حار', 'بدون مايونيز'],
          note: 'قطع صغير',
        },
        {
          name: 'بطاطس محمرة',
          quantity: 1,
          modifiers: ['كبير'],
          note: null,
        },
        {
          name: 'كولا',
          quantity: 2,
          modifiers: [],
          note: null,
        },
      ],
    }
  }

  if (id === 'receipt_dine_in') {
    return {
      ...b,
      order_reference: 'ORD-000125',
      invoice_label: 'فاتورة #ORD-000125',
      order_type_ar: 'صالة',
      table_ref: 'ط12',
      customer_name: 'عائلة أحمد',
      customer_phone: null,
      delivery_address: null,
      payment_status_ar: 'مدفوع',
      payment_method: 'بطاقة',
      lines: [
        {
          name: 'مشويات مشكلة',
          quantity: 1,
          unit_price: 180,
          line_total: 180,
          modifiers: ['زيادة لحمة'],
          note: null,
        },
        {
          name: 'سلطة خضراء',
          quantity: 2,
          unit_price: 25,
          line_total: 50,
          modifiers: [],
          note: 'بدون خيار',
        },
      ],
      subtotal: 230,
      discount_amount: 10,
      tax_amount: 0,
      total: 220,
      change_total: 0,
      payments: [{ method: 'بطاقة', amount: 220, net_amount: 220 }],
    }
  }

  if (id === 'receipt_takeaway') {
    return {
      ...b,
      order_reference: 'ORD-000126',
      invoice_label: 'فاتورة #ORD-000126',
      order_type_ar: 'استلام',
      table_ref: null,
      customer_name: 'سارة',
      customer_phone: '01001234567',
      delivery_address: null,
      payment_status_ar: 'مدفوع',
      payment_method: 'نقدي',
      lines: [
        {
          name: 'برجر لحم',
          quantity: 1,
          unit_price: 75,
          line_total: 75,
          modifiers: ['جبنة', 'بدون مخلل'],
          note: null,
        },
        {
          name: 'عصير برتقال',
          quantity: 1,
          unit_price: 20,
          line_total: 20,
          modifiers: [],
          note: null,
        },
      ],
      subtotal: 95,
      discount_amount: 0,
      tax_amount: 0,
      total: 95,
      change_total: 5,
      payments: [{ method: 'نقدي', amount: 100, net_amount: 95 }],
    }
  }

  // receipt_delivery — default: richest field coverage
  return {
    ...b,
    order_reference: 'ORD-000127',
    invoice_label: 'فاتورة #ORD-000127',
    order_type_ar: 'دليفري',
    table_ref: null,
    customer_name: 'محمود علي حسن',
    customer_phone: '01107666987',
    delivery_address: 'أسوان - الكورنيش - عمارة 14 - الدور 3 - شقة 8',
    payment_status_ar: 'مدفوع',
    payment_method: 'نقدي',
    lines: [
      {
        name: 'ترياكي دجاج',
        quantity: 2,
        unit_price: 55,
        line_total: 120,
        modifiers: [
          { name: 'حار', price_delta: 5 },
          { name: 'جبنة إضافية', price_delta: 5 },
        ],
        note: 'بدون بصل',
      },
      {
        name: 'بطاطس محمرة',
        quantity: 1,
        unit_price: 30,
        line_total: 35,
        modifiers: [{ name: 'كبير', price_delta: 5 }],
        note: null,
      },
      {
        name: 'كولا',
        quantity: 2,
        unit_price: 15,
        line_total: 30,
        modifiers: [],
        note: null,
      },
    ],
    subtotal: 185,
    discount_amount: 15,
    tax_amount: 0,
    total: 170,
    change_total: 30,
    payments: [{ method: 'نقدي', amount: 200, net_amount: 170 }],
  }
}

export const PREVIEW_SCENARIOS: PreviewScenario[] = [
  {
    id: 'receipt_delivery',
    documentType: 'receipt',
    labelKey: 'receipt_delivery',
    descriptionKey: 'receipt_delivery_hint',
    snapshot: buildScenarioSnapshot('receipt_delivery'),
  },
  {
    id: 'receipt_dine_in',
    documentType: 'receipt',
    labelKey: 'receipt_dine_in',
    descriptionKey: 'receipt_dine_in_hint',
    snapshot: buildScenarioSnapshot('receipt_dine_in'),
  },
  {
    id: 'receipt_takeaway',
    documentType: 'receipt',
    labelKey: 'receipt_takeaway',
    descriptionKey: 'receipt_takeaway_hint',
    snapshot: buildScenarioSnapshot('receipt_takeaway'),
  },
  {
    id: 'kitchen_full',
    documentType: 'kitchen',
    labelKey: 'kitchen_full',
    descriptionKey: 'kitchen_full_hint',
    snapshot: buildScenarioSnapshot('kitchen_full'),
  },
]

export function scenariosForDocumentType(
  type: 'receipt' | 'kitchen',
): PreviewScenario[] {
  return PREVIEW_SCENARIOS.filter((s) => s.documentType === type)
}

export function defaultScenarioId(
  type: 'receipt' | 'kitchen',
): PreviewScenarioId {
  return type === 'kitchen' ? 'kitchen_full' : 'receipt_delivery'
}
