# ADR-0027: M5 Close-Out — Financial-Only Post-Approve & Delivery Drivers

## Status

Accepted (M5 close-out slice)

## Context

M5 needed to close the POS operational loop before **M6 Printing** ([ADR-0029](./0029-m6-printing-before-kds.md)). Prior ADRs locked:

- ADR-0025: collection approval on operational drawer balance
- ADR-0026: free edit blocked after approved collection; review queue for edits after any collection

M5 close-out adds real order types, customers as entities, delivery captains, unified search, and shift close tied to approval.

## Decisions

### 1. Post-approve amend = financial only (append-only)

After `has_approved_collection`:

- **Allowed:** `record_collection` for remaining, `reverse_collection` for decreases, surface `over_collected_amount`
- **Not in M5:** structural line-item amend (`amend_order` stays stub / `AMEND_USE_FINANCIAL_DELTA`)

No UPDATE of existing `order_payments` amounts.

### 2. Order types

- Real `dine_in` | `takeaway` | `delivery` in RPCs and UI
- `dine_in_table_ref` optional text only — no table map / merge / move
- `finalize_sale` accepts order metadata so pay-now works for all types

### 3. Delivery drivers entity

- Table `delivery_drivers` + `orders.delivery_driver_id` FK
- Assign/change via `assign_delivery_driver`; timeline events `delivery.driver_assigned` / `delivery.driver_changed`
- No free-text captain as source of truth (snapshot columns remain for customer delivery info only)

### 4. UX locks preserved

- Collection approval + operational drawer balance stay on **admin treasury drawer card** only
- Cashier hub shows collected / unpaid / partial — not pending/approved collection lifecycle

### 5. Shift close — summary first

- `CollectionApprovalDialog`: KPIs + approve-all default; exceptions secondary
- Covers **pending collections and pending expenses** (same F1 gate — [ADR-0028](./0028-pending-expense-approval-lifecycle.md))
- `CloseShiftDialog`: approval step when pending > 0 before cash count; warn if closing with pending (not hard block)

### 6. Cashier expense = pending only

- `pos_record_expense` checks **operational drawer**, creates `pending` expense, **no ledger** until manager approve
- Operational drawer = approved + pending cash − pending expenses

## Consequences

- M6 Printing can assume orders, customers, drivers, and financial delta path exist
- Structural post-approve amend deferred to a later slice with kitchen/print implications
- All cashier-originated money ops share pending → approve → ledger (collections + expenses)
