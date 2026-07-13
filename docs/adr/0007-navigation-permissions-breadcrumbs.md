# ADR-0007: Navigation, permissions & breadcrumbs architecture

**Status:** Accepted
**Date:** 2026-07-07
**Track:** U1 — App Foundation (Step 3, Admin Shell).

## Context

The admin shell needs a sidebar, header, breadcrumbs, and user menu that all modules reuse. To avoid
per-module drift and duplicated navigation logic, the product owner set four requirements: a single
source of truth for navigation, breadcrumbs derived from route metadata (not hand-written per page),
an extensible user menu, and **permission-driven** navigation (hide what the user cannot access, not
just protect routes).

## Decision

1. **Single source of truth for navigation.** `src/app/navigation/admin-nav.ts` holds the nav model
   — `id`, `to`, `label` (from the i18n catalog), `icon` (Lucide), and required `permission`. The
   sidebar renders **dynamically** from this list. A parallel `userMenuItems` list drives the user
   menu the same way.

2. **Permission model.** `src/features/auth/permissions.ts` defines a `Permission` union and derives
   the current user's permission set from their staff roles (`computePermissions`). A `usePermissions`
   hook exposes `can(permission)`. **Navigation items are filtered by `can(...)`** so unauthorized
   items never render. Route guards remain as defense-in-depth (visibility ≠ authorization).

3. **Breadcrumbs from route metadata.** `src/app/navigation/route-meta.ts` is a registry of
   `{ path, title, parent }`. `buildBreadcrumbs(pathname)` walks the parent chain to produce the
   trail. The `Breadcrumbs` component reads the current location and renders it — **pages never
   declare breadcrumbs manually**. (The app uses the component `<Routes>` API, so a metadata registry
   is used instead of data-router `handle`; the registry stays the single place to add titles.)

4. **Extensible user menu.** The user menu is built from `userMenuItems` and includes Profile,
   Settings, Change Password, and Sign out from the start. Their pages are placeholders in U1 but the
   structure is final, so future work only fills the pages.

## Consequences

- Adding a screen = add one nav entry (+ its permission) and one route-meta entry; sidebar and
  breadcrumbs update automatically.
- Permissions are declarative and centralized; role→permission mapping evolves in one file as
  modules add capabilities.
- U1 permissions are role-derived (owner/manager vs cashier/waiter/kitchen). Finer-grained,
  per-capability permissions can extend the same `Permission` union later without touching consumers.
- The sidebar collapse state persists in `localStorage`; mobile uses an overlay drawer.

## Notes / future

- When a data router is adopted, breadcrumbs could move to route `handle`; the `route-meta` registry
  is intentionally the single abstraction so that migration is localized.
- Permission checks currently gate visibility + existing route guards; a generic `RequirePermission`
  guard can replace role-specific guards later.
