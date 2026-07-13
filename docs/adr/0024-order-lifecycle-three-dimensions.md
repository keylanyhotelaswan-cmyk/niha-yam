# ADR-0024: Order lifecycle — three independent status dimensions

**Status:** Accepted (M5B Part A) · **Amended 2026-07-08** (payment status + collection approval)
**Date:** 2026-07-08
**Complements:** [ADR-0021](./0021-pos-thin-client-financial-core.md) (POS thin client),
[ADR-0025](./0025-revenue-collection-approval.md) (revenue collection approval — **required for payment status**),
[ADR-0005](./0005-financial-approval-and-reversal-model.md) (F1 — no direct financial edits),
[ADR-0010](./0010-performance-first-architecture.md) (performance first),
[ADR-0020](./0020-operations-first.md) (operations first).

## Context

M5A delivers quick Takeaway sales via `finalize_sale`: the order is created **paid and closed** in
one atomic step with immediate ledger posting. M5B completes the order lifecycle: Delivery, orders
hub, customers, amendments — and **separates order progress from collection approval** per
[ADR-0025](./0025-revenue-collection-approval.md).

A single `status` column cannot represent payment, kitchen/fulfillment, and printing independently.

## Decision

> Every order exposes **three independent status dimensions**. No composite "mega-status".

| Dimension | Purpose | Values (M5B / M5C) |
| --------- | ------- | ------------ |
| **Payment status** | Customer settlement vs order total (**Collected** = pending + approved) | `unpaid` · `partial` · `paid` |
| **Fulfillment status** | Operational progress to the customer | `new` · `preparing` · `ready` · `delivered` · `cancelled` |
| **Print status** | Receipt/kitchen print intent (derived or stored) | `not_needed` · `pending` · `done` · `failed` |

Additionally, **financial/legal order status** (`closed` · `voided` · `refunded`) remains separate —
it reflects F1 lifecycle, not day-to-day cashier filters.

**Collection approval (ADR-0025)** is a **separate axis** on each **collection record**
(`pending` · `approved` · `rejected` · `reversed`). Hub may filter "pending collections" and also
show **Order Total / Collected / Remaining / Payment Status** (four amounts).

An order may be **Paid + Pending Approval** at once — no contradiction (ADR-0025 §1.1).

### Rules

1. **Never merge dimensions in UI or API.** Filters and cards show all three where relevant.
2. **`payment_status` (customer axis)** uses **Collected Amount** = sum of `pending` + `approved`
   net collections vs order total. Rejected/reversed do not count. **Ledger / official revenue**
   still use **approved only** (ADR-0025).
3. **Order and fulfillment proceed independently of collection approval** unless a future policy
   explicitly links them (default: independent).
4. **Print status** reflects latest print jobs (M5 enqueues; **M6 executes** —
   [ADR-0029](./0029-m6-printing-before-kds.md)). Reprint creates a **new**
   job + audit event.
5. **Amendments** append deltas — never UPDATE existing ledger movements (ADR-0021 + F1 + ADR-0025).
   While pending: collect **Remaining only** on total increase (ADR-0025 §2.1 / ADR-0026).
6. **Findability:** any order reachable in **≤ 5 seconds** by reference, customer phone, or name.
7. **Order timeline (M5B):** append-only `order_events` per order; `get_order_detail` returns
   `timeline[]` for the detail screen. Dual-writes to `audit_log` via `record_order_event()`.
   Event types include: `order.created`, `collection.*`, `kitchen.sent`, `print.enqueued`,
   `fulfillment.updated`, `order.delivered`, `order.cancelled`, `order.amended`.
8. **Edit regimes ([ADR-0026](./0026-pending-order-edit-and-review.md)):** free edit while no
   approved collections (**M5C**); after approve — amend/reverse only (F1). Post-collection edits
   set `requires_review` and feed the admin review queue.

## Consequences

- M5B refactors `finalize_sale` money path per ADR-0025 (record → approve → ledger).
- Delivery: `create_order` → fulfillment may advance while collection still pending/unpaid.
- **M6** executes print jobs (receipt + kitchen paper); optional **M7 KDS** later consumes the same
  events/jobs without becoming a second SSOT ([ADR-0029](./0029-m6-printing-before-kds.md)).
