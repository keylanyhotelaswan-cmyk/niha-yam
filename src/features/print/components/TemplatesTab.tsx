import { kindLabel } from '@/features/print/components/print-labels'
import type { PrintTemplateRow } from '@/features/print/types'
import { Badge } from '@/shared/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/patterns/EmptyState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'

type Props = { templates: PrintTemplateRow[] }

export function TemplatesTab({ templates }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.print.templates.heading}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {t.print.templates.noBuilder}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {templates.length === 0 ? (
          <EmptyState title={t.print.templates.empty} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.print.templates.name}</TableHead>
                <TableHead>{t.print.templates.kind}</TableHead>
                <TableHead>{t.print.templates.version}</TableHead>
                <TableHead>{t.print.templates.active}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((tpl) => (
                <TableRow key={tpl.id}>
                  <TableCell className="font-medium">{tpl.name}</TableCell>
                  <TableCell>{kindLabel(tpl.kind)}</TableCell>
                  <TableCell>v{tpl.version}</TableCell>
                  <TableCell>
                    <Badge variant={tpl.is_active ? 'success' : 'secondary'}>
                      {tpl.is_active
                        ? t.print.common.active
                        : t.print.common.inactive}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
