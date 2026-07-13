# ADR-0002: Arabic-first, RTL by default

**Status:** Accepted
**Date:** 2026-07-07

## Context

NIHA POS targets Arabic-speaking restaurants. The prior placeholder UI was English/LTR. Retrofitting
direction and language after many screens exist is expensive and error-prone. The product owner set
the direction: Arabic is the primary language; RTL is the default.

## Decision

- The application is **Arabic-first**: Arabic is the sole UI language in U1. All user-facing copy
  lives in `src/shared/i18n/ar/` (message files, grouped by domain). No inline English in JSX.
- The document is **RTL by default**: `<html lang="ar" dir="rtl">`.
- Components use **logical CSS** utilities (`ms`/`me`, `ps`/`pe`, `start`/`end`) rather than
  physical `left`/`right` so layouts work correctly in RTL.
- No i18n library (e.g. react-i18next) is added yet — message files suffice for an Arabic-only UI.
  A library will be introduced only when a second locale (English) is actually required.

## Consequences

- Every new screen inherits Arabic + RTL from the foundation; no per-module redesign.
- Directional icons must be mirrored explicitly where needed.
- Adding English later requires introducing an i18n library and extracting the `ar/` messages into a
  keyed catalog — a known, bounded migration.
