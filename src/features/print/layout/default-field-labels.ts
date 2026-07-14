/**
 * Default printable field labels (Arabic) — baked into DocumentLayout JSON.
 * Bridge must NOT hardcode these; it only reads layout field.label_ar / label_en.
 */
export const DEFAULT_FIELD_LABEL_AR: Record<string, string> = {
  title: 'تذكرة مطبخ',
  name: '',
  slogan_text: '',
  address: '',
  phone: '',
  invoice_number: 'رقم الفاتورة',
  order_reference: 'رقم الطلب',
  order_type: 'نوع الطلب',
  kitchen_ticket: 'تذكرة',
  created_by_name: 'أنشأ الطلب',
  last_edited_by_name: 'آخر تعديل بواسطة',
  collected_by_name: 'تم التحصيل بواسطة',
  created_at: 'وقت الإنشاء',
  last_edited_at: 'وقت آخر تعديل',
  collected_at: 'وقت التحصيل',
  printed_at: 'وقت الطباعة',
  customer_name: 'العميل',
  customer_phone: 'هاتف العميل',
  delivery_zone: 'المنطقة',
  delivery_address: 'العنوان',
  delivery_notes: 'ملاحظات التوصيل',
  driver_name: 'المندوب',
  table_ref: 'الطاولة',
  item_line: '',
  price: '',
  modifiers: '',
  line_note: '',
  order_note_text: 'ملاحظة',
  note: 'ملاحظة',
  subtotal: 'إجمالي الطلب',
  discount: 'الخصم',
  tax: 'الضريبة',
  total: 'الإجمالي النهائي',
  payment_lines: 'وسائل الدفع',
  payment_method: 'الدفع',
  payment_status: 'الحالة',
  change: 'الباقي',
  method: 'الدفع',
  status: 'الحالة',
  shift_reference: 'رقم الوردية',
  branch_name: 'الفرع',
  device_name: 'الجهاز',
  qr_code: '',
  thank_you_message: '',
  message: '',
}

export const DEFAULT_FIELD_LABEL_EN: Record<string, string> = {
  title: 'Kitchen Ticket',
  invoice_number: 'Invoice',
  order_reference: 'Order',
  order_type: 'Order type',
  kitchen_ticket: 'Ticket',
  created_by_name: 'Created by',
  last_edited_by_name: 'Last edited by',
  collected_by_name: 'Collected by',
  created_at: 'Created at',
  last_edited_at: 'Last edited at',
  collected_at: 'Collected at',
  printed_at: 'Printed at',
  customer_name: 'Customer',
  customer_phone: 'Customer phone',
  delivery_zone: 'Zone',
  delivery_address: 'Address',
  delivery_notes: 'Delivery notes',
  driver_name: 'Driver',
  table_ref: 'Table',
  order_note_text: 'Note',
  note: 'Note',
  subtotal: 'Order total',
  discount: 'Discount',
  tax: 'Tax',
  total: 'Final total',
  payment_lines: 'Payments',
  payment_method: 'Payment',
  payment_status: 'Status',
  change: 'Change',
  method: 'Payment',
  status: 'Status',
  shift_reference: 'Shift',
  branch_name: 'Branch',
  device_name: 'Device',
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
