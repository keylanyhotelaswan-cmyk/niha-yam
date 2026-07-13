import { useMemo, useState } from 'react'
import { MoreHorizontal, Star } from 'lucide-react'
import { CategoryDialog } from '@/features/menu/components/dialogs/CategoryDialog'
import { ItemDialog } from '@/features/menu/components/dialogs/ItemDialog'
import {
  useSetCategoryStatus,
  useSetItemStatus,
} from '@/features/menu/hooks/useMenuMutations'
import type {
  MenuCategory,
  MenuItem,
  ModifierGroup,
} from '@/features/menu/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { t } from '@/shared/i18n'

type ProductsTabProps = {
  categories: MenuCategory[]
  items: MenuItem[]
  modifierGroups: ModifierGroup[]
}

type CategoryDialogState = { category: MenuCategory | null } | null
type ItemDialogState = { item: MenuItem | null } | null

export function ProductsTab({
  categories,
  items,
  modifierGroups,
}: ProductsTabProps) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogState>(null)
  const [itemDialog, setItemDialog] = useState<ItemDialogState>(null)

  const setCategoryStatus = useSetCategoryStatus()
  const setItemStatus = useSetItemStatus()

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]))
    return (id: string | null) =>
      id ? (map.get(id) ?? '—') : t.menu.categories.uncategorized
  }, [categories])

  // Client-side search by name + SKU (S2) and category filter — no request (ADR-0010).
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (categoryFilter === 'uncategorized' && item.category_id !== null) {
        return false
      }
      if (
        categoryFilter !== 'all' &&
        categoryFilter !== 'uncategorized' &&
        item.category_id !== categoryFilter
      ) {
        return false
      }
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        (item.sku ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, query, categoryFilter])

  return (
    <div className="space-y-6">
      {/* Categories */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.menu.categories.heading}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCategoryDialog({ category: null })}
          >
            {t.menu.categories.add}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {categories.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              {t.menu.categories.empty}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.menu.categories.name}</TableHead>
                  <TableHead className="w-28">
                    {t.menu.common.sortOrder}
                  </TableHead>
                  <TableHead className="w-28">
                    {t.menu.common.showInPos}
                  </TableHead>
                  <TableHead className="w-28">
                    {t.menu.items.colStatus}
                  </TableHead>
                  <TableHead className="w-16 text-end">
                    {t.menu.common.rowActions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.sort_order}</TableCell>
                    <TableCell>{c.show_in_pos ? '✓' : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={c.is_active ? 'success' : 'secondary'}>
                        {c.is_active
                          ? t.menu.status.active
                          : t.menu.status.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.menu.common.rowActions}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setCategoryDialog({ category: c })}
                          >
                            {t.menu.categories.edit}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() =>
                              setCategoryStatus.mutate({
                                id: c.id,
                                active: !c.is_active,
                              })
                            }
                          >
                            {c.is_active
                              ? t.menu.categories.deactivate
                              : t.menu.categories.activate}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>{t.menu.items.heading}</CardTitle>
          <Button size="sm" onClick={() => setItemDialog({ item: null })}>
            {t.menu.items.add}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-3 p-4">
            <Input
              type="search"
              className="max-w-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.menu.items.searchPlaceholder}
              aria-label={t.menu.items.searchPlaceholder}
            />
            <select
              className="border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label={t.menu.categories.all}
            >
              <option value="all">{t.menu.categories.all}</option>
              <option value="uncategorized">
                {t.menu.categories.uncategorized}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.menu.items.colName}</TableHead>
                <TableHead>{t.menu.items.colCategory}</TableHead>
                <TableHead className="w-28">{t.menu.items.colPrice}</TableHead>
                <TableHead className="w-28">{t.menu.items.colStatus}</TableHead>
                <TableHead className="w-16 text-end">
                  {t.menu.common.rowActions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-8 text-center text-sm"
                  >
                    {items.length === 0
                      ? t.menu.items.empty
                      : t.menu.items.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {item.is_favorite ? (
                          <Star
                            className="text-warning size-4"
                            aria-label={t.menu.items.favoriteBadge}
                          />
                        ) : null}
                        {item.name}
                        {!item.show_in_pos ? (
                          <Badge variant="secondary">
                            {t.menu.items.hiddenBadge}
                          </Badge>
                        ) : null}
                      </span>
                      {item.sku ? (
                        <span className="text-muted-foreground block text-xs">
                          {item.sku}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {categoryName(item.category_id)}
                    </TableCell>
                    <TableCell>
                      {item.is_open_price
                        ? t.menu.items.isOpenPrice
                        : item.base_price.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.is_active ? 'success' : 'secondary'}>
                        {item.is_active
                          ? t.menu.status.active
                          : t.menu.status.inactive}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t.menu.common.rowActions}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setItemDialog({ item })}
                          >
                            {t.menu.items.edit}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() =>
                              setItemStatus.mutate({
                                id: item.id,
                                active: !item.is_active,
                              })
                            }
                          >
                            {item.is_active
                              ? t.menu.items.deactivate
                              : t.menu.items.activate}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {categoryDialog ? (
        <CategoryDialog
          category={categoryDialog.category}
          open
          onOpenChange={(next) => !next && setCategoryDialog(null)}
        />
      ) : null}

      {itemDialog ? (
        <ItemDialog
          item={itemDialog.item}
          categories={categories}
          modifierGroups={modifierGroups}
          open
          onOpenChange={(next) => !next && setItemDialog(null)}
        />
      ) : null}
    </div>
  )
}
