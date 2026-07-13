# NIHA POS — UX Guidelines

**Status:** Canonical (in-repo). These conventions are demonstrated live on `/admin/design-system`
and must be followed by every module. New shared components must be added to the design-system page
in the same change set.

The app is **Arabic-first / RTL**. All user-facing copy is Arabic and lives in `src/shared/i18n/ar/`.

---

## 1. Language & direction

- `<html lang="ar" dir="rtl">`.
- Prefer logical CSS utilities: `ms-*`/`me-*`, `ps-*`/`pe-*`, `start`/`end`, `border-s`/`border-e`
  over `ml`/`mr`/`left`/`right`.
- Mirror directional icons (chevrons/arrows) in RTL (`rtl:rotate-180` where appropriate).
- Numbers and dates formatted via `Intl` with the `ar` locale where shown.

## 2. Token-only styling (hard rule)

No raw color or arbitrary design values in components. Use design tokens only.

| Allowed                                                      | Not allowed                             |
| ------------------------------------------------------------ | --------------------------------------- |
| `bg-primary`, `text-foreground`, `border-border`             | `#fff`, `rgb(...)`, `oklch(...)` inline |
| `rounded-lg` (token)                                         | `rounded-[13px]`                        |
| `shadow-sm` (token)                                          | `shadow-[0_4px_12px_rgba(...)]`         |
| `gap-4`, `p-6` (scale)                                       | `p-[17px]`                              |
| Semantic status: `destructive`, `success`, `warning`, `info` | one-off greens/reds                     |

Exceptions: token definitions in `src/index.css`, and the design-system page displaying raw values
for documentation. Enforced by `pnpm lint:tokens` in CI.

## 3. Actions

| Rule           | Convention                                                                           |
| -------------- | ------------------------------------------------------------------------------------ |
| Primary action | Visual start side in RTL — e.g. **حفظ**                                              |
| Cancel / back  | Secondary outline, next to primary — **إلغاء**                                       |
| Destructive    | `destructive` variant + confirm dialog; explicit verb (**إلغاء تفعيل**, not **نعم**) |
| Disabled       | Explain via tooltip/helper text when non-obvious                                     |

## 4. Feedback

| Event   | Pattern                                                         |
| ------- | --------------------------------------------------------------- |
| Success | Toast (top-start in RTL)                                        |
| Error   | Toast for transient; inline `Alert` for form errors             |
| Loading | Button `loading` prop; page `LoadingState`; table skeleton rows |

## 5. Forms

- Labels above fields; required fields marked `*`.
- Validation messages below the field in `text-destructive text-sm`.
- Submit on Enter for single-column forms.

## 6. Tables

- Header `bg-muted/50`; row hover `hover:bg-muted/30`.
- Empty → centered `EmptyState` in the table body (not a blank table).
- Actions column: icon buttons with Arabic `aria-label`.
- Numeric columns align end; text aligns start.
- Pagination below table; page size 10 / 25 / 50 (default 25).

## 7. Search

- Debounced 300ms; placeholder **بحث…**; clear button when a value is present.
- Lives in the table toolbar above the table.

## 8. Standard page structure

Every admin list page:

1. `PageHeader` — title, optional description, primary action.
2. `DataTableToolbar` — search / filters.
3. Table or content.
4. Pagination (if applicable).

## 9. States

Provide all three for any data view: `EmptyState`, `LoadingState`, `ErrorState` (with retry).
