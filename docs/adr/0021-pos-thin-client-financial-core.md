# ADR-0021: POS is a thin client over the financial core

**Status:** Accepted
**Date:** 2026-07-08
**Complements:** [ADR-0005](./0005-financial-approval-and-reversal-model.md) (F1 — financial approval &
reversal), [ADR-0013](./0013-multi-treasury-foundation.md) (multi-treasury), [ADR-0010](./0010-performance-first-architecture.md)
(performance first), [ADR-0020](./0020-operations-first.md) (operations first).

## Context

M4 established the financial core: an append-only treasury ledger as the single source of truth,
computed balances (no summary tables), the F1 approval/reversal lifecycle, multi-treasury transfers,
shifts, and financial references — all written **only** through `SECURITY DEFINER` RPCs, with RLS
granting clients read-only access (proven immutable in the M4 review: direct ledger edits are blocked).

M5 (POS) will capture sales and payments. There is a real risk that a fast POS screen starts doing
money work on the client — summing a cart, deciding which treasury a payment lands in, or inserting
ledger rows directly — which would fork the source of truth and undermine F1 and multi-treasury.

## Decision

> **The POS UI never computes balances, never edits treasuries, and never creates ledger movements.**
> POS collects a **Sale Intent** (items, modifiers, discounts, and the tenders the cashier took) and
> submits it to a **single financial RPC** that performs the entire operation inside **one atomic
> transaction**.

That RPC (M5) is responsible for **all** money logic:

1. Create the sale/order record.
2. Create the payment records (supporting **split tender**).
3. Post the ledger movements (F1), auto-approved for POS payments per the M4 approval matrix.
4. Update the open shift (link movements to the shift).
5. Distribute each tender to the correct treasury **by payment method → treasury mapping** (M4 settings).
6. Return the authoritative result (totals, change, references) for display/printing only.

### Rules

1. **Server owns money.** Amount math that affects what is owed, paid, or banked happens server-side.
   The client may show a provisional cart total for UX, but the RPC recomputes and is authoritative.
2. **No client-side ledger writes.** POS calls domain RPCs; it never inserts/updates
   `treasury_movements`, `treasuries`, `payment_methods`, `shifts`, or any financial operation table.
3. **One transaction per sale.** Order + payments + ledger + shift update succeed or fail together;
   no partial financial state is ever visible.
4. **Mapping, not hardcoding.** Which treasury a payment method feeds is read from M4 settings, not
   branched in POS code.
5. **M4 stays the single source of truth.** Reports, balances, and reconciliation continue to be
   computed from the ledger; POS adds inputs, never a parallel truth.
6. **Desktop-forward.** Because money logic is server-side and the ledger is cloud-authoritative,
   a future desktop shell (Tauri/Electron) for direct printing / cash-drawer stays a thin client too.

## Consequences

- M5 introduces a `finalize_sale`-style RPC (exact name TBD in the M5 plan) as the sole write path for
  a completed sale; the POS screen is an operation surface, not a financial engine.
- Testing money behavior stays at the RPC layer (as with `pnpm test:m4`), independent of UI.
- If POS ever needs a new money behavior, it is added to the financial RPC/core, not to the screen.
- **M5B amendment ([ADR-0025](./0025-revenue-collection-approval.md)):** POS payments follow F1
  collection approval — ledger posts on **approve**, not on record. `finalize_sale` in M5B records
  pending collections; manager bulk-approves at shift close (or ad-hoc). Cashier sees **operational
  drawer balance** (includes pending cash); official balances remain ledger-only. M5A immediate-post
  behaviour is superseded for new sales after M5B migration.
