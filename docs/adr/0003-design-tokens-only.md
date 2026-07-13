# ADR-0003: Design tokens are the only source of visual values

**Status:** Accepted
**Date:** 2026-07-07

## Context

To keep a consistent, themeable, professional UI across many modules, visual values (colors,
radius, spacing, shadows, typography) must be centralized. Scattered raw hex/rgb values and
arbitrary Tailwind values (`p-[17px]`, `shadow-[...]`) cause drift and block future theming
(e.g. dark mode).

## Decision

- All visual values are defined as **design tokens** (CSS variables mapped into Tailwind's theme in
  `src/index.css`).
- Components and features may use **only** token-backed utilities (`bg-primary`, `rounded-lg`,
  `shadow-sm`, spacing scale) and semantic status tokens (`destructive`, `success`, `warning`,
  `info`).
- Raw color literals (`#…`, `rgb(…)`, `hsl(…)`, `oklch(…)`) and arbitrary bracket values are **not
  allowed** inside `src/features/**` and `src/shared/components/**`.
- Enforcement: a `pnpm lint:tokens` script fails CI if raw color literals are found in those paths.
  Exceptions: token definitions in `src/index.css`, and the design-system page (documents raw
  values).

## Consequences

- Consistent look; single place to retune the palette or add dark mode later.
- A small amount of friction for genuinely one-off values — handled by adding a token or an
  explicit, documented allowlist entry.
- The `/admin/design-system` page is the living catalog of all tokens and components.
