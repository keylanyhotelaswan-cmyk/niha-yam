# ADR-0011: Design System page as living documentation

**Status:** Accepted
**Date:** 2026-07-07
**Track:** U1 — App Foundation (Step 6).

## Context

The `/admin/design-system` page must be more than a showcase. It is the **official living
documentation** for every component, so a developer joining later can understand how the system is
built from **docs + ADRs + Design System** alone — without reading past conversations.

## Decision

1. **Every component documented uniformly.** Each entry shows: name, purpose, when to use, when not
   to use, all variants, all sizes, all states (default/hover/focus/disabled/loading/error where
   applicable), a props table, a correct usage example, and an incorrect example when useful.

2. **Doc-kit is page-local.** The documentation UI (`ComponentDoc`, `PropsTable`, `StatesGrid`,
   `UsageExample`, `DoDont`, `Swatch`) lives under `src/app/routes/admin/design-system/` — it is not
   a shared component because it has no other consumer (ADR-0008 principle 2).

3. **Performance Guidelines section.** The page includes a summary of the performance rules
   (ADR-0010): no fetching in shared components, no duplicate state, no unnecessary requests, no
   unnecessary re-renders, prefer stateless components, performance is part of Definition of Done.

4. **Standing rule (from ADR-0008 §6.5):** any new shared component MUST be added to this page in the
   same change set. The page is the contract, not an afterthought.

## Consequences

- Onboarding relies on in-repo artifacts (docs, ADRs, design system), not chat history.
- The page grows with the library; keeping it current is part of each component's Definition of Done.
- Because the doc-kit is page-local, it can evolve freely without affecting product components.
