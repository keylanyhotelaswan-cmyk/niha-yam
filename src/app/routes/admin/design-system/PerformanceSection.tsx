import { Gauge } from 'lucide-react'
import { DocSection } from './doc-kit'

const rules = [
  'لا Fetch داخل المكوّنات المشتركة (Primitives/Patterns).',
  'لا Duplicate State — مصدر حقيقة واحد.',
  'لا Requests غير ضرورية — لكل طلب سبب واضح.',
  'لا Re-render بدون سبب.',
  'المكوّنات Stateless كلما أمكن.',
  'Measure before optimize.',
  'الأداء جزء من Definition of Done.',
  'مسار الكاشير له الأولوية القصوى.',
]

export function PerformanceSection() {
  return (
    <DocSection
      id="performance"
      title="إرشادات الأداء (Performance Guidelines)"
      description="قواعد ملزمة لكل تطوير مستقبلي — الأداء ميزة، ومعيار القبول الأول (ADR-0010)."
    >
      <div className="bg-card rounded-lg border p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
            <Gauge className="size-5" aria-hidden />
          </span>
          <p className="font-medium">القواعد الأساسية</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {rules.map((rule) => (
            <li
              key={rule}
              className="bg-muted/40 text-muted-foreground rounded-md px-3 py-2 text-sm"
            >
              {rule}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-4 text-sm">
          الهدف: أن يشعر الكاشير أن النظام فوري. أي قرار يجب أن يجعل التجربة
          أسرع أو ألا يجعلها أبطأ. لا نبني Optimistic UI غير صحيح، ولا نضيف
          انتظارًا بلا قيمة. راجع{' '}
          <span className="font-mono text-xs">
            docs/adr/0010-performance-first-architecture.md
          </span>
          .
        </p>
      </div>
    </DocSection>
  )
}
