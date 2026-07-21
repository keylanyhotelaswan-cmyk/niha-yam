# ADR-0028: Pending expense approval lifecycle (align with collections)

**Status:** **Superseded (2026-07-19)** — expenses (and all operational money ops) execute on
create; Reject = reverse. Pending→approve gate removed.
**Amendment 2026-07-21:** `approve_expense` / `approve_pending_for_shift` raise `APPROVE_REMOVED`.
Residual pending (rare) → `heal_residual_pending_for_shift` (ops/scripts only).
**Date:** 2026-07-09
**Complements:** [ADR-0025](./0025-revenue-collection-approval.md),
[ADR-0005](./0005-financial-approval-and-reversal-model.md),
[ADR-0027](./0027-m5-close-out-financial-drivers.md)

### Amendment 2026-07-19 — execute now / reject = reverse

`pos_record_expense` / `create_expense` insert `status=executed` + `treasury_movements` immediately
(`auto_approved=true`). Same for manager transfers and deposit/withdrawal. Manager **Reject** on an
executed row calls `reverse_*` (append-only). No Approve step in UI. Close-shift no longer bulk-approves.

## Context

POS cashier expenses (`pos_record_expense`) previously:

1. Checked **`treasury_balance` (approved ledger only)** → raised `INSUFFICIENT_FUNDS` when the
   drawer held pending cash but little approved float.
2. Wrote **`treasury_movements` immediately** (`status = executed`, `auto_approved = true`).

That broke the dual-balance model and treated expenses differently from collections.

## Decision (historical — superseded 2026-07-19)

> **Cashier financial ops share one lifecycle:** record → **pending** → manager approve/reject →
> **ledger only on approve**. Append-only; never UPDATE prior ledger rows.

### 1. Unified lifecycle

```
Sale Collection / Expense / (future: advance, custody, refund, variance)
        ↓
     Pending
        ↓
  Manager Approve | Reject
        ↓
  Ledger (approve only)
```

### 2. Cashier `pos_record_expense`

| Rule | Behaviour |
| ---- | --------- |
| Coverage check | **`m5b_operational_treasury_balance(drawer, shift)`** — not approved-only |
| Row status | `expenses.status = pending` |
| Ledger | **None** until `approve_expense` |
| Audit | `expense.created` with `status: pending` |

### 3. Operational drawer formula (amended)

```
operational_drawer :=
  treasury_balance(drawer)                    -- approved ledger
  + sum(net pending cash collections)         -- physical cash claimed in
  − sum(pending expenses for drawer/shift)    -- physical cash claimed out
```

Pending expenses reduce what the cashier can spend next; they do **not** hit official balances
until approved.

### 4. Manager approval surface

Same screen as collection approval (shift close / treasury drawer card):

| Section | Metrics |
| ------- | ------- |
| Pending collections | count, total, by payment method |
| Pending expenses | count, total, by category; reason/description on rows |

Actions: approve all · approve one · reject one · reject all (reason required).

`approve_pending_for_shift` approves **collections then expenses**.
`reject_pending_for_shift` rejects both with one reason.

### 5. Approve expense coverage

For shift-drawer expenses: available = operational balance **+ this expense amount** (because
operational already subtracts all pending expenses including the row being approved). Non-drawer
manager expenses keep approved `treasury_balance` check (M4).

### 6. Official vs operational (unchanged axes)

| Metric | Includes pending expenses? |
| ------ | -------------------------- |
| Approved ledger / M8 | **No** — only after execute |
| Operational drawer | **Yes** — subtract pending |
| Cashier UX labels | No pending/approved jargon on POS shell |

## Consequences

- Root cause of cashier `INSUFFICIENT_FUNDS` with cash in drawer: wrong balance function.
- ADR-0025 §9 formula extended by subtracting pending expenses (see amendment note there).
- Future cashier ops (سلفة، عهدة، مرتجع، تسوية) reuse the same pending → approve → ledger path.
- Migration: `20260709140000_m5_pending_expense_lifecycle.sql`
