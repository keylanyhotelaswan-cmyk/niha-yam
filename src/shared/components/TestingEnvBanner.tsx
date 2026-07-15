import { isTestingEnv } from '@/shared/config/appEnv'

/**
 * Persistent top banner so operators never confuse Testing with Production.
 * Fixed overlay — does not steal layout height from POS `h-dvh` screens.
 */
export function TestingEnvBanner() {
  if (!isTestingEnv()) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 border-b border-[#9a3412] bg-[#ea580c] px-3 py-1.5 text-center text-xs font-bold tracking-wide text-white shadow-sm"
    >
      <span aria-hidden>🧪</span>
      <span>بيئة اختبار (Testing) – جميع البيانات هنا تجريبية</span>
      <span className="hidden font-semibold opacity-90 sm:inline">
        · لا تُكتب على الإنتاج
      </span>
    </div>
  )
}
