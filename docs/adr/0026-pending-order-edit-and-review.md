# ADR-0026: Pending-order free edit & post-collection review controls

**Status:** Accepted (policy locked) — **Implementation: M5C** (not M5B close-out, not M6 Printing / M7 KDS)
**Date:** 2026-07-09
**Amended:** 2026-07-09 — delta-only collect; aligns with ADR-0025 §1.1–§2.1 (customer vs approval axes)
**Complements:** [ADR-0024](./0024-order-lifecycle-three-dimensions.md),
[ADR-0025](./0025-revenue-collection-approval.md),
[ADR-0005](./0005-financial-approval-and-reversal-model.md) (F1).

## Context

With ADR-0025, collections stay `pending` until end-of-shift (or ad-hoc) approval. In live
restaurant operation, cashiers must correct mistakes **before** money becomes final: wrong item,
wrong qty, wrong modifiers, wrong customer, wrong tender / split.

Orders may also be created **without** any collection (pay later). After a partial or full pending
collection, adding items must collect **Remaining only** — never recreate the full tender.

Once a collection is **approved**, the ledger has posted — free mutation would break F1. Formal
`amend_order` / financial delta / `reverse_collection` remain the only path after approve.

Managers also need visibility: any edit after a collection was recorded (even while still pending)
deserves review, optionally with external alerts (Telegram / WhatsApp).

## Decision

### 1. Two edit regimes (hard gate on **approved** collections)

| Collection state on order | Cashier edit | Mechanism |
| ------------------------- | ------------ | --------- |
| **No approved collections** (unpaid with zero rows, or only `pending` / `rejected`) | **Full free edit** of items, qty, modifiers, customer | `edit_pending_order` (M5C) — rewrite operational lines; **no ledger** |
| Same + need to change tenders | Replace tenders **append-only**: reject pending row(s) + new `record_collection` | Never UPDATE amounts |
| **Any `approved` collection** | **No free edit** | Only `amend_order` + collection delta / `reverse_collection` (F1) |

### 1.1 Money on edit — **delta only** (ADR-0025 §2.1)

When order total changes while collections exist:

- **Do not** delete/recreate the whole collection set for a simple item add.
- **Increase:** keep existing pending/approved rows; `Remaining = Total − Collected`; collect Remaining only.
- **Decrease:** never mutate old rows; if over-collected → manager path (reject excess pending / reverse approved excess).

Example: Total 190 → Collected 190 pending → add 40 → Total 230, Collected 190, Remaining 40, `partial`.

### 1.2 Create: pay now vs pay later

| Mode | Collections at create |
| ---- | --------------------- |
| محصل | `record_collection` → pending |
| غير محصل | none — `unpaid`, editable, collect later (full or partial) |

### 1.3 Four amounts always shown

Order Total · Collected Amount · Remaining Amount · Payment Status — plus separate approval badges
per collection / hub filter for pending approval (ADR-0025 §1.1–§1.2).

### 2. Timeline — every change is an event

All free edits and formal amendments append to `order_events` (and matching `audit_log`), e.g.:

- `order.created` · `collection.recorded`
- `order.item_added` · `order.item_removed` · `order.qty_changed` · `order.modifiers_changed`
- `order.customer_changed` · `order.tender_changed` · `order.total_changed`
- `collection.approved` · `order.amended` (post-approve path)

Detail screen shows the full chronological timeline (already started in M5B).

### 3. `requires_review` flag

On **any** edit after at least one collection has been **recorded** for that order
(`collection.recorded` exists — pending or later), set:

```text
orders.requires_review = true
```

even if the monetary total is unchanged. Cleared only by an explicit manager action
(`clear_order_review` / acknowledge in review queue) — not by approve alone (approve may leave
flag set until manager reviews the edit history).

### 4. In-app review queue (always on)

Admin surface: **طلبات تحتاج مراجعة** — lists orders with `requires_review = true`.

Each row / detail shows: what changed, who, when, before/after amounts, full timeline.

### 5. External notifications (optional setting)

Restaurant setting (default **off**): notify managers on post-collection edit via configured
channel(s): Telegram, WhatsApp, or future providers.

Payload: order ref · cashier name · edit type(s) · financial delta (if any) · timestamp.

Channel wiring is infrastructure — implement behind a notification port; do not hard-code a single
vendor in core RPCs.

### 6. Scope placement

| Work | Module |
| ---- | ------ |
| Pay now / pay later create · four amounts · `payment_status` from Collected | **M5C** (recalc + UI; M5B may still use approved-only until M5C ships) |
| Free edit + delta collect + timeline event types + `requires_review` + review queue | **M5C** |
| Optional Telegram/WhatsApp (or other) notification adapters + settings UI | **M5C** (feature-flagged) |
| Formal post-approve `amend_order` / reverse (F1) | **M5C** |
| Kitchen display | **M7 (deferred)** — must **not** absorb this work; printing is **M6** ([ADR-0029](./0029-m6-printing-before-kds.md)) |

**M5B** closes with: collection approval lifecycle, dual balance, orders hub, customers foundation,
order timeline table + create/collection/kitchen/print events. Free-edit + review queue + customer
payment axis recalc are **explicitly deferred to M5C**, not to printing or KDS.

## Consequences

- M5B Final Review does **not** require free-edit UI or Collected/Remaining hub columns.
- M5C must update `m5b_recalc_order_payment_status` (or successor) so `payment_status` uses
  pending + approved (customer axis), while ledger remains approved-only.
- **M5 is Approved**; next module is **M6 Printing** (not KDS). M5C remains order/finance control.
- Does not weaken ADR-0025 money rules: pending still posts no ledger; approve still posts.
