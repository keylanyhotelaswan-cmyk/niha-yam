import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/shared/components/ui/alert'
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Separator } from '@/shared/components/ui/separator'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Spinner } from '@/shared/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'
import {
  ComponentDoc,
  DocSection,
  Preview,
  PropsTable,
  StatesGrid,
  UsageExample,
} from './doc-kit'

export function PrimitivesSection() {
  return (
    <DocSection
      id="primitives"
      title="المكوّنات الأساسية (UI Primitives)"
      description="مكوّنات Core UI مستقرة الواجهة (ADR-0008). كلها Token-only وتدعم لوحة المفاتيح وRTL."
    >
      <ButtonDoc />
      <InputDoc />
      <LabelDoc />
      <BadgeDoc />
      <AvatarDoc />
      <AlertDoc />
      <SkeletonSpinnerDoc />
      <SeparatorDoc />
      <DialogDoc />
      <DropdownDoc />
      <TableDoc />
    </DocSection>
  )
}

function ButtonDoc() {
  return (
    <ComponentDoc
      name="Button"
      purpose="زر الإجراءات الأساسي في النظام، مع variants وحالة تحميل."
      whenToUse={[
        'تنفيذ إجراء (حفظ، إنشاء، تأكيد).',
        'فتح حوار أو قائمة عبر asChild.',
      ]}
      whenNotToUse={[
        'التنقّل بين الصفحات (استخدم رابطًا).',
        'عرض حالة غير تفاعلية.',
      ]}
    >
      <StatesGrid
        items={[
          { label: 'default', node: <Button>حفظ</Button> },
          {
            label: 'secondary',
            node: <Button variant="secondary">ثانوي</Button>,
          },
          { label: 'outline', node: <Button variant="outline">إطار</Button> },
          { label: 'ghost', node: <Button variant="ghost">شفاف</Button> },
          {
            label: 'destructive',
            node: <Button variant="destructive">حذف</Button>,
          },
          { label: 'loading', node: <Button loading>حفظ</Button> },
          { label: 'disabled', node: <Button disabled>معطّل</Button> },
          { label: 'sm', node: <Button size="sm">صغير</Button> },
          { label: 'lg', node: <Button size="lg">كبير</Button> },
        ]}
      />
      <PropsTable
        rows={[
          {
            name: 'variant',
            type: "'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'",
            default: "'default'",
            description: 'النمط البصري للزر.',
          },
          {
            name: 'size',
            type: "'default' | 'sm' | 'lg' | 'icon'",
            default: "'default'",
            description: 'حجم الزر.',
          },
          {
            name: 'loading',
            type: 'boolean',
            default: 'false',
            description: 'يعرض Spinner ويعطّل الزر.',
          },
          {
            name: 'asChild',
            type: 'boolean',
            default: 'false',
            description: 'يمرّر الأنماط لعنصر ابن (مثل رابط).',
          },
        ]}
      />
      <UsageExample
        code={`<Button loading={mutation.isPending} onClick={submit}>\n  {t.common.save}\n</Button>`}
      />
    </ComponentDoc>
  )
}

function InputDoc() {
  return (
    <ComponentDoc
      name="Input"
      purpose="حقل إدخال نصي موحّد مع دعم حالة الخطأ عبر aria-invalid."
      whenToUse={[
        'إدخال نص/بريد/رقم داخل نموذج.',
        'ربطه بـ Label عبر htmlFor.',
      ]}
      whenNotToUse={[
        'اختيار من قائمة (سيأتي Select لاحقًا).',
        'نص طويل متعدد الأسطر.',
      ]}
    >
      <StatesGrid
        items={[
          { label: 'default', node: <Input placeholder="الاسم" /> },
          {
            label: 'error (aria-invalid)',
            node: <Input aria-invalid placeholder="بريد غير صالح" />,
          },
          { label: 'disabled', node: <Input disabled placeholder="معطّل" /> },
        ]}
      />
      <PropsTable
        rows={[
          {
            name: 'aria-invalid',
            type: 'boolean',
            description: 'يفعّل حدود/حلقة تركيز الخطأ.',
          },
          {
            name: '...props',
            type: "React.ComponentProps<'input'>",
            description: 'كل خصائص input الأصلية (value, onChange, type…).',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function LabelDoc() {
  return (
    <ComponentDoc
      name="Label"
      purpose="تسمية حقل مع مؤشر اختياري للحقل المطلوب."
      whenToUse={['وصف حقل إدخال وربطه به عبر htmlFor.']}
      whenNotToUse={['عنوان قسم أو صفحة (استخدم عنوانًا دلاليًا).']}
    >
      <Preview>
        <div className="w-full max-w-xs space-y-2">
          <Label htmlFor="ds-name" required>
            الاسم
          </Label>
          <Input id="ds-name" placeholder="اكتب الاسم" />
        </div>
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'required',
            type: 'boolean',
            default: 'false',
            description: 'يعرض علامة (*) بعد النص.',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function BadgeDoc() {
  return (
    <ComponentDoc
      name="Badge"
      purpose="وسم صغير لعرض حالة أو تصنيف."
      whenToUse={['عرض حالة (نشط/موقوف) أو دور مستخدم.']}
      whenNotToUse={['كزر قابل للنقر (استخدم Button).']}
    >
      <Preview>
        <Badge>افتراضي</Badge>
        <Badge variant="secondary">ثانوي</Badge>
        <Badge variant="outline">إطار</Badge>
        <Badge variant="success">نشط</Badge>
        <Badge variant="warning">تحذير</Badge>
        <Badge variant="info">معلومة</Badge>
        <Badge variant="destructive">موقوف</Badge>
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'variant',
            type: "'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'info' | 'destructive'",
            default: "'default'",
            description: 'لون الوسم الدلالي.',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function AvatarDoc() {
  return (
    <ComponentDoc
      name="Avatar"
      purpose="صورة مستخدم دائرية مع بديل حرفي عند غياب الصورة."
      whenToUse={['تمثيل مستخدم/موظف في الهيدر أو الجداول.']}
      whenNotToUse={['أيقونات عامة (استخدم أيقونة Lucide).']}
    >
      <Preview>
        <Avatar>
          <AvatarFallback>نم</AvatarFallback>
        </Avatar>
        <Avatar className="size-12">
          <AvatarFallback>عمر</AvatarFallback>
        </Avatar>
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'Avatar / AvatarImage / AvatarFallback',
            type: 'Radix Avatar parts',
            description: 'تركيب: صورة مع بديل نصي احتياطي.',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function AlertDoc() {
  return (
    <ComponentDoc
      name="Alert"
      purpose="تنبيه مضمّن داخل الصفحة لرسائل الحالة."
      whenToUse={['خطأ نموذج مضمّن، أو رسالة معلومات دائمة.']}
      whenNotToUse={['رسائل عابرة (استخدم Toast).']}
    >
      <div className="w-full space-y-3">
        <Alert>
          <AlertTitle>معلومة</AlertTitle>
          <AlertDescription>هذه رسالة معلومات عامة.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>خطأ</AlertTitle>
          <AlertDescription>تعذّر حفظ البيانات.</AlertDescription>
        </Alert>
        <Alert variant="success">
          <AlertTitle>تم</AlertTitle>
          <AlertDescription>تم الحفظ بنجاح.</AlertDescription>
        </Alert>
      </div>
      <PropsTable
        rows={[
          {
            name: 'variant',
            type: "'default' | 'destructive' | 'success' | 'warning' | 'info'",
            default: "'default'",
            description: 'لون التنبيه الدلالي.',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function SkeletonSpinnerDoc() {
  return (
    <ComponentDoc
      name="Skeleton + Spinner"
      purpose="مؤشرات تحميل: هيكل عظمي للمحتوى، ودوّار للأزرار والأقسام."
      whenToUse={['أثناء انتظار بيانات؛ Skeleton للقوائم، Spinner للأزرار.']}
      whenNotToUse={['لأخطاء (استخدم ErrorState) أو فراغ (EmptyState).']}
    >
      <Preview>
        <div className="w-full max-w-xs space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Spinner label={t.patterns.loading.label} className="size-6" />
      </Preview>
    </ComponentDoc>
  )
}

function SeparatorDoc() {
  return (
    <ComponentDoc
      name="Separator"
      purpose="فاصل بصري أفقي أو رأسي (Radix)."
      whenToUse={['فصل مجموعات داخل قائمة أو بطاقة.']}
      whenNotToUse={['كإطار لعنصر (استخدم border).']}
    >
      <Preview className="flex-col items-stretch">
        <span className="text-sm">القسم الأول</span>
        <Separator />
        <span className="text-sm">القسم الثاني</span>
      </Preview>
      <PropsTable
        rows={[
          {
            name: 'orientation',
            type: "'horizontal' | 'vertical'",
            default: "'horizontal'",
            description: 'اتجاه الفاصل.',
          },
        ]}
      />
    </ComponentDoc>
  )
}

function DialogDoc() {
  return (
    <ComponentDoc
      name="Dialog"
      purpose="نافذة حوارية معيارية (Radix) مع حبس التركيز وإغلاق بـ Esc."
      whenToUse={['نماذج قصيرة، تفاصيل، تأكيدات عامة (عبر ConfirmDialog).']}
      whenNotToUse={['تدفقات طويلة (استخدم صفحة)، أو تأكيدات مالية (F1).']}
    >
      <Preview>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">فتح الحوار</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>عنوان الحوار</DialogTitle>
              <DialogDescription>وصف مختصر للحوار.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t.common.cancel}</Button>
              </DialogClose>
              <Button>{t.common.confirm}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Preview>
      <UsageExample
        code={`<Dialog>\n  <DialogTrigger asChild><Button>فتح</Button></DialogTrigger>\n  <DialogContent> … </DialogContent>\n</Dialog>`}
      />
    </ComponentDoc>
  )
}

function DropdownDoc() {
  return (
    <ComponentDoc
      name="DropdownMenu"
      purpose="قائمة إجراءات منسدلة (Radix) مع تنقّل بلوحة المفاتيح."
      whenToUse={['قائمة المستخدم، إجراءات صف في جدول.']}
      whenNotToUse={['اختيار قيمة في نموذج (سيأتي Select لاحقًا).']}
    >
      <Preview>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">الإجراءات</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>الحساب</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>الملف الشخصي</DropdownMenuItem>
            <DropdownMenuItem>الإعدادات</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Preview>
    </ComponentDoc>
  )
}

function TableDoc() {
  return (
    <ComponentDoc
      name="Table"
      purpose="غلاف دلالي بسيط للجداول (بدون ترقيم/فرز/فلترة — ADR-0008)."
      whenToUse={['عرض بيانات جدولية بسيطة.']}
      whenNotToUse={['جداول متقدمة بترقيم/فرز (DataTable في M2).']}
    >
      <div className="w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>الدور</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>عمر</TableCell>
              <TableCell>كاشير</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>سارة</TableCell>
              <TableCell>مدير</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </ComponentDoc>
  )
}
