export const shell = {
  brand: 'NIHA POS',
  adminLabel: 'الإدارة',
  posSubtitle: 'نقطة البيع',
  signOut: 'تسجيل الخروج',
  nav: {
    dashboard: 'لوحة التحكم',
    health: 'الحالة',
    pos: 'نقطة البيع',
    menu: 'القائمة والمنتجات',
    treasury: 'الخزائن والأموال',
    reports: 'التقارير',
    recipes: 'الوصفات والتكلفة',
    inventory: 'المخزون',
    purchasing: 'المشتريات',
    orderReview: 'طلبات تحتاج مراجعة',
    printCenter: 'مركز الطباعة',
    opsFeedback: 'مركز ملاحظات التشغيل',
    staff: 'الموظفون',
    designSystem: 'نظام التصميم',
  },
  sidebar: {
    primary: 'التنقّل',
    collapse: 'طيّ القائمة الجانبية',
    expand: 'توسيع القائمة الجانبية',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
  },
  breadcrumbs: {
    label: 'مسار التنقّل',
  },
  userMenu: {
    account: 'الحساب',
    profile: 'الملف الشخصي',
    settings: 'الإعدادات',
    changePassword: 'تغيير كلمة المرور',
  },
  session: {
    loading: 'جارٍ تحميل الجلسة…',
    noStaffTitle: 'لا يوجد وصول',
    noStaffBody: 'حسابك غير مرتبط بملف موظف. تواصل مع مدير المطعم.',
    disabledTitle: 'تم تعطيل الحساب',
    disabledBody:
      'تم تعطيل هذا الحساب بواسطة الإدارة. تواصل مع مدير المطعم إذا كنت تعتقد أن ذلك حدث بالخطأ.',
    signOut: 'تسجيل الخروج',
    redirectCountdown: (seconds: number) =>
      `سيتم إعادتك إلى صفحة تسجيل الدخول خلال ${seconds} ثوانٍ.`,
  },
  pages: {
    dashboard: {
      title: 'لوحة التحكم',
      body: 'ملخصات سريعة وروابط إلى التقارير والإدارة.',
    },
    profile: {
      title: 'الملف الشخصي',
      body: 'ستتوفر إدارة الملف الشخصي هنا.',
    },
    settings: {
      title: 'الإعدادات',
      body: 'ستتوفر إعدادات الحساب هنا.',
    },
    changePassword: {
      title: 'تغيير كلمة المرور',
      body: 'سيتوفر تغيير كلمة المرور هنا.',
    },
    designSystem: {
      title: 'نظام التصميم',
      body: 'كتالوج المكوّنات والـ Design Tokens — قيد الإنشاء ضمن مرحلة U1.',
    },
  },
  posPlaceholder: {
    title: 'واجهة نقطة البيع',
    body: 'ستُعرض وحدات الطلبات والمدفوعات والمطبخ هنا.',
  },
} as const
