# ADR-0006: Typography & color identity

**Status:** Accepted
**Date:** 2026-07-07

## Context

U1 establishes the visual identity. Two concrete choices were needed and approved by the product
owner: the primary typeface (Arabic-first) and the brand color, plus the token scales for radius and
elevation. These must be defined as tokens (ADR-0003) before components are built.

## Decision

- **Typeface:** **IBM Plex Sans Arabic** (via `@fontsource/ibm-plex-sans-arabic`, weights 400/500/
  600/700). Excellent mixed Arabic/Latin support and a dense, professional admin feel. Exposed as
  the `--font-sans` token; applied to `body`.
- **Brand color:** **Teal** as `--primary` on a **neutral slate** base. Teal also drives `--ring`
  and the active state in the sidebar. Defined in `oklch` for perceptual consistency and easy
  theming.
- **Semantic status tokens:** `success` (green), `warning` (amber), `info` (blue), `destructive`
  (red) — each with a paired `*-foreground`.
- **Sidebar tokens:** a deep-slate sidebar (`--sidebar*`) with teal active state, kept as its own
  token group so the shell reads as a professional commercial-POS admin.
- **Radius scale:** base `--radius: 0.5rem` → `sm`/`md`/`lg`/`xl`.
- **Elevation:** `--elevation-sm/md/lg` mapped to Tailwind `--shadow-*` so only `shadow-sm/md/lg`
  are used in components.

All values live in `src/index.css` and are mapped into Tailwind's theme via `@theme inline`. No raw
color or arbitrary values are permitted in components (enforced later by `pnpm lint:tokens`).

## Consequences

- One place to retune palette/typography or add a dark theme later (add a `.dark`/`[data-theme]`
  block overriding the `:root` tokens — structure already supports it).
- Components reference semantic tokens (`bg-primary`, `text-muted-foreground`, `bg-success`) rather
  than concrete colors, keeping the UI consistent across all modules.
- The `/admin/design-system` page will render these tokens as the living catalog.
