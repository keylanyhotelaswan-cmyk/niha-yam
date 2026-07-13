# ADR-0004: App Foundation (U1) inserted before M2

**Status:** Accepted
**Date:** 2026-07-07

## Context

After M1 the app was functional but visually placeholder, English, and LTR. The product owner wanted
a professional Arabic/RTL commercial-POS UI and did not want to redesign every screen inside each
feature module. Two options were considered: (a) a standalone foundation stage before M2, or
(b) folding the foundation into the start of M2.

## Decision

Insert a dedicated foundation track **U1 — App Foundation** between M1 and M2:
`M0 → M1 → U1 → M2 → …`.

U1 scope is both a **documentation foundation** (this `docs/` folder: architecture, domain model,
workflows, printing design, ADRs) and a **UI/UX foundation** (Arabic/RTL, design tokens, admin
shell, component library, UX rules, `/admin/design-system`). M1 screens are retrofitted onto the new
foundation. U1 does **not** include Organization CRUD (that remains M2) or any backend/schema
changes.

## Consequences

- Arabic/RTL and the design system are established once; later modules consume them without
  redesign budget.
- Documentation becomes the in-repo source of truth from the start (docs-first).
- Slight delay before M2 feature work begins, accepted deliberately.
- The module sequence in `docs/modules.md` reflects U1 as a foundation track.

## Rejected alternative

Folding the foundation into M2 — rejected because it would mix "is the design right?" with "does
branch CRUD work?" in one review, and risk inconsistent, ad-hoc design carried forward as
convention.
