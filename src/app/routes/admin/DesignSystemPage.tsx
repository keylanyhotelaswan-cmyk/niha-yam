import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { t } from '@/shared/i18n'
import { FoundationsSection } from './design-system/FoundationsSection'
import { PatternsSection } from './design-system/PatternsSection'
import { PerformanceSection } from './design-system/PerformanceSection'
import { PrimitivesSection } from './design-system/PrimitivesSection'

const tocItems = [
  { id: 'foundations', label: 'الأساسيات' },
  { id: 'primitives', label: 'المكوّنات الأساسية' },
  { id: 'patterns', label: 'الأنماط المركّبة' },
  { id: 'performance', label: 'إرشادات الأداء' },
]

export function DesignSystemPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title={t.shell.pages.designSystem.title}
        description="المرجع الرسمي الحيّ لكل مكوّنات NIHA POS: الغرض، الحالات، الخصائص، وأمثلة الاستخدام."
      />

      <nav
        aria-label="محتويات نظام التصميم"
        className="bg-card flex flex-wrap gap-2 rounded-lg border p-3"
      >
        {tocItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="hover:bg-muted rounded-md px-3 py-1.5 text-sm transition-colors"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <FoundationsSection />
      <PrimitivesSection />
      <PatternsSection />
      <PerformanceSection />
    </div>
  )
}
