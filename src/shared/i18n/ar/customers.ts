export const customers = {
  profile: {
    title: 'ملف العميل',
    orderCount: 'عدد الطلبات',
    totalSpend: 'إجمالي المشتريات',
    addresses: 'العناوين',
    recentOrders: 'آخر الطلبات',
    lastOrder: 'آخر طلب',
    lastVisit: 'آخر زيارة',
    openOrder: 'طلب مفتوح حاليًا',
    noOpenOrder: 'لا يوجد طلب مفتوح',
  },
  search: {
    placeholder: 'بحث بالهاتف أو الاسم…',
    noResults: 'لا يوجد عميل مطابق.',
    frequent: 'عملاء دائمون',
  },
  pick: {
    select: 'اختر عميلًا',
    lookup: 'بحث بالهاتف',
  },
  phoneFirst: {
    placeholder: 'رقم الهاتف…',
    matched: 'عميل مسجل',
    willCreate: 'سيُحفظ كعميل جديد تلقائيًا عند إنشاء الطلب.',
    walkinHint: 'اترك الهاتف فارغًا لعميل عابر.',
    savedAddresses: 'عناوين محفوظة',
    defaultAddress: 'افتراضي',
    newAddress: 'عنوان جديد أو تعديل…',
  },
} as const
