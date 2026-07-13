import { Inbox } from 'lucide-react'
import { ConfirmDialog } from '@/shared/components/patterns/ConfirmDialog'
import { EmptyState } from '@/shared/components/patterns/EmptyState'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { Button } from '@/shared/components/ui/button'
import {
  ComponentDoc,
  DocSection,
  DoDont,
  Preview,
  PropsTable,
} from './doc-kit'

export function PatternsSection() {
  return (
    <DocSection
      id="patterns"
      title="الأنماط المركّبة (Composite Patterns)"
      description="أنماط عرض Stateless فوق المكوّنات الأساسية — بلا بيانات أو fetch أو منطق أعمال (ADR-0008)."
    >
      <PageHeaderDoc />
      <EmptyStateDoc />
      <LoadingStateDoc />
      <ErrorStateDoc />
      <ConfirmDialogDoc />
    </DocSection>
  )
}

function PageHeaderDoc() {
  return (
    <ComponentDoc
      name="PageHeader"
      purpose="رأس صفحة موحّد: عنوان + وصف + slot إجراءات."
      whenToUse={['أعلى كل صفحة إدارة.', 'وضع الإجراء الأساسي في actions.']}
      whenNotToUse={['كعنوان قسم داخلي صغير.']}
    >
      <Preview className="block">
        <PageHeader
          title="الموظفون"
          description="إدارة فريق العمل والصلاحيات."
          actions={<Button size="sm">دعوة موظف</Button>}
        />
      </Preview>
      <PropsTable
        rows={[
          { name: 'title', type: 'ReactNode', description: 'عنوان الصفحة.' },
          {
            name: 'description',
            type: 'ReactNode',
            default: '—',
            description: 'وصف اختياري تحت العنوان.',
          },
          {
            name: 'actions',
            type: 'ReactNode',
            default: '—',
            description: 'slot الإجراءات (أزرار).',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function EmptyStateDoc() {
  return (
    <ComponentDoc
      name="EmptyState"
      purpose="حالة فراغ ودّية بدل جدول/قائمة فارغة."
      whenToUse={['لا توجد بيانات بعد؛ مع CTA لإضافة أول عنصر.']}
      whenNotToUse={['أثناء التحميل (LoadingState) أو عند خطأ (ErrorState).']}
    >
      <Preview className="block">
        <EmptyState
          icon={Inbox}
          title="لا يوجد موظفون"
          description="ابدأ بدعوة أول موظف لفريقك."
          action={<Button size="sm">دعوة موظف</Button>}
        />
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'icon',
            type: 'LucideIcon',
            default: '—',
            description: 'أيقونة توضيحية.',
          },
          {
            name: 'title',
            type: 'ReactNode',
            default: 'افتراضي عربي',
            description: 'العنوان.',
          },
          {
            name: 'description',
            type: 'ReactNode',
            default: 'افتراضي عربي',
            description: 'وصف.',
          },
          {
            name: 'action',
            type: 'ReactNode',
            default: '—',
            description: 'زر CTA اختياري.',
          },
        ]}
      />
      <DoDont
        doNote="مرّر النص والإجراء من الـ feature."
        doCode={`<EmptyState\n  title="لا يوجد موظفون"\n  action={<Button onClick={openInvite}>دعوة</Button>}\n/>`}
        dontNote="لا تجعل النمط يجلب بيانات ليقرر الفراغ."
        dontCode={`// ❌ النمط لا يعرف سبب الفراغ\n<EmptyState fetchStaff={...} />`}
      />
    </ComponentDoc>
  )
}

function LoadingStateDoc() {
  return (
    <ComponentDoc
      name="LoadingState"
      purpose="مؤشر تحميل مركزي مع نص وصول."
      whenToUse={['انتظار جلب بيانات على مستوى قسم/صفحة.']}
      whenNotToUse={['داخل زر (استخدم Button loading).']}
    >
      <Preview className="block">
        <LoadingState />
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'label',
            type: 'string',
            default: 'افتراضي عربي',
            description: 'نص التحميل (لوحة الوصول أيضًا).',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function ErrorStateDoc() {
  return (
    <ComponentDoc
      name="ErrorState"
      purpose="حالة خطأ مع إعادة محاولة اختيارية."
      whenToUse={['فشل جلب البيانات؛ onRetry يستدعي refetch من الـ feature.']}
      whenNotToUse={['أخطاء تحقّق النماذج (استخدم Alert مضمّن).']}
    >
      <Preview className="block">
        <ErrorState onRetry={() => undefined} />
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'title',
            type: 'ReactNode',
            default: 'افتراضي عربي',
            description: 'العنوان.',
          },
          {
            name: 'description',
            type: 'ReactNode',
            default: 'افتراضي عربي',
            description: 'الوصف.',
          },
          {
            name: 'onRetry',
            type: '() => void',
            default: '—',
            description: 'معالِج إعادة المحاولة (مملوك للـ feature).',
          },
        ]}
      />
      <DoDont
        doNote="onRetry = refetch من React Query في الـ feature."
        doCode={`<ErrorState onRetry={() => query.refetch()} />`}
        dontNote="النمط لا يجلب البيانات بنفسه."
        dontCode={`// ❌ لا fetch داخل النمط\n<ErrorState url="/api/staff" />`}
      />
    </ComponentDoc>
  )
}

function ConfirmDialogDoc() {
  return (
    <ComponentDoc
      name="ConfirmDialog"
      purpose="تأكيد عام لإجراء (Controlled + Uncontrolled)."
      whenToUse={['تأكيدات عامة (إلغاء تفعيل موظف، حذف عنصر غير مالي).']}
      whenNotToUse={[
        'أي تأكيد مالي (تحصيل/تراجع/مصروف/خزنة) — يمر عبر F1 / ADR-0005.',
      ]}
    >
      <Preview>
        <ConfirmDialog
          trigger={<Button variant="destructive">إلغاء تفعيل</Button>}
          title="إلغاء تفعيل الموظف"
          description="لن يتمكن الموظف من الدخول بعد الآن. يمكن إعادة تفعيله لاحقًا."
          confirmLabel="إلغاء التفعيل"
          confirmVariant="destructive"
          onConfirm={() => undefined}
        />
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'onConfirm',
            type: '() => void',
            description: 'المعالِج (منطق الأعمال في الـ feature).',
          },
          {
            name: 'confirmVariant',
            type: "ButtonProps['variant']",
            default: "'default'",
            description: 'نمط زر التأكيد.',
          },
          {
            name: 'loading',
            type: 'boolean',
            default: 'false',
            description: 'يعطّل ويُظهر Spinner أثناء التنفيذ.',
          },
          {
            name: 'trigger',
            type: 'ReactNode',
            default: '—',
            description: 'استخدام uncontrolled.',
          },
          {
            name: 'open / onOpenChange',
            type: 'boolean / (open) => void',
            default: '—',
            description: 'استخدام controlled.',
          },
        ]}
      />
      <DoDont
        doNote="تأكيد عام غير مالي."
        doCode={`<ConfirmDialog\n  onConfirm={() => deactivate(id)}\n  loading={m.isPending}\n/>`}
        dontNote="التحصيل المالي يمر عبر F1 وليس هذا النمط."
        dontCode={`// ❌ لا تستخدمه للعمليات المالية\n<ConfirmDialog onConfirm={collectPayment} />`}
      />
    </ComponentDoc>
  )
}
