# ADR-0031: Draft Orders in the database (architectural direction)

**Status:** Accepted as **direction** (2026-07-11) — not an M6 implementation requirement  
**Date:** 2026-07-11  
**Complements:** [ADR-0023](./0023-offline-ready-pos-design.md), [ADR-0026](./0026-pending-order-edit-and-review.md), POS held drafts (`sessionStorage`).

## Context

POS “held” / parked carts today live in browser `sessionStorage` (`pos.heldDrafts.v1`). That is fast for M6, but:

- Closing the browser or device loses held work.
- Staff cannot resume a draft from another terminal.
- Restaurant operations expect parked tickets to survive shift handoff and restarts.

## Decision

> **Direction:** replace (or back) session-held drafts with **Draft Orders** persisted in Postgres, scoped to the restaurant (and optionally cashier / station).

M6 may ship with `sessionStorage` held drafts. Implementing DB drafts is **not** a gate for M6 final sign-off if it would delay print WYSIWYG / Bridge BP-15 closure.

## Consequences (when implemented)

- Drafts survive browser close, power loss, and device switch.
- Clear lifecycle: draft → submitted order (or discarded), with audit if needed.
- Aligns with restaurant “parked ticket” mental model better than ephemeral browser storage.
- Requires RLS, retention policy, and conflict rules (two cashiers editing the same draft).

## Non-goals for M6

- Full offline sync of drafts across devices.
- Replacing pending **submitted** orders (those already live in `orders`).
