export const auth = {
  fields: {
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
  },
  login: {
    title: 'تسجيل الدخول',
    subtitle: 'NIHA POS — دخول الموظفين',
    submit: 'تسجيل الدخول',
    invalidCredentials: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    failed: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
  },
  gateway: {
    title: 'اختر الواجهة',
    subtitle: 'إلى أين تريد الانتقال؟',
    welcome: (name: string) => `مرحبًا ${name}`,
    admin: 'الدخول إلى الإدارة',
    pos: 'الدخول إلى الكاشير (POS)',
    callCenter: 'مركز الاتصال',
  },
} as const
