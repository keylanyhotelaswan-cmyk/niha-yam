/**
 * Default printable field labels (Arabic) — baked into DocumentLayout JSON.
 * Bridge must NOT hardcode these; it only reads layout field.label_ar / label_en.
 */
export const DEFAULT_FIELD_LABEL_AR: Record<string, string> = {
  // ticket / restaurant
  title: 'تذكرة مطبخ',
  name: '',
  slogan_text: '',
  address: '',
  phone: '',
  // invoice / order meta
  invoice_number: 'فاتورة',
  order_reference: 'طلب',
  datetime: '',
  cashier: 'كاشير',
  order_type: 'النوع',
  kitchen_ticket: 'تذكرة',
  // customer
  customer_name: 'العميل',
  customer_phone: 'هاتف',
  delivery_address: 'العنوان',
  table_ref: 'الطاولة',
  // lines
  item_line: '',
  price: '',
  modifiers: '',
  line_note: '',
  // order note
  order_note_text: 'ملاحظة',
  note: 'ملاحظة',
  // totals
  subtotal: 'المجموع',
  discount: 'الخصم',
  tax: 'الضريبة',
  total: 'الإجمالي',
  // payment
  payment_method: 'الدفع',
  payment_status: 'الحالة',
  change: 'الباقي',
  method: 'الدفع',
  status: 'الحالة',
  // other
  qr_code: '',
  thank_you_message: '',
  message: '',
}

export const DEFAULT_FIELD_LABEL_EN: Record<string, string> = {
  title: 'Kitchen Ticket',
  invoice_number: 'Invoice',
  order_reference: 'Order',
  cashier: 'Cashier',
  order_type: 'Type',
  kitchen_ticket: 'Ticket',
  customer_name: 'Customer',
  customer_phone: 'Phone',
  delivery_address: 'Address',
  table_ref: 'Table',
  order_note_text: 'Note',
  note: 'Note',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  total: 'Total',
  payment_method: 'Payment',
  payment_status: 'Status',
  change: 'Change',
  method: 'Payment',
  status: 'Status',
}

export function defaultLabelArForField(fieldId: string, labelKey?: string): string {
  return (
    DEFAULT_FIELD_LABEL_AR[fieldId] ??
    (labelKey ? DEFAULT_FIELD_LABEL_AR[labelKey] : undefined) ??
    ''
  )
}

export function defaultLabelEnForField(fieldId: string, labelKey?: string): string {
  return (
    DEFAULT_FIELD_LABEL_EN[fieldId] ??
    (labelKey ? DEFAULT_FIELD_LABEL_EN[labelKey] : undefined) ??
    ''
  )
}
