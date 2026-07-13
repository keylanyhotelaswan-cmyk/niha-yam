export const patterns = {
  empty: {
    title: 'لا توجد بيانات',
    description: 'لا يوجد شيء لعرضه حتى الآن.',
  },
  error: {
    title: 'تعذّر تحميل البيانات',
    description: 'حدث خطأ أثناء التحميل. يمكنك إعادة المحاولة.',
  },
  loading: {
    label: 'جارٍ التحميل…',
  },
  confirm: {
    title: 'تأكيد الإجراء',
    description: 'هل أنت متأكد من المتابعة؟',
  },
} as const
