# ADR-0013: Multi-Treasury Foundation (F1 extension)

**Status:** Accepted (principle) · Implementation deferred (Planning Only)
**Date:** 2026-07-07
**Track:** F1 — Financial Approval Foundation (this ADR extends F1; see
[ADR-0005](./adr/0005-financial-approval-and-reversal-model.md)).
**Applies to:** M4 (Shifts & Treasury), M6 (Payments), M10 (Expenses), M12 (Reports).

## Context

The previous system assumed effectively a single cash box, which broke down once card, InstaPay, and
e-wallet money had to be tracked separately. The product owner requires that NIHA POS **not depend on
a single treasury** and that payment-method → treasury linkage be **configuration**, not code.

## Decision (principle only — nothing built now)

The system will support **multiple treasuries** (financial accounts), each independent. This is a
financial principle **inside F1**, so all multi-treasury operations still obey the F1 approval &
reversal rules.

### Treasuries

- The system supports many treasuries, e.g. **cash**, **cards**, **InstaPay**, **e-wallets**, and any
  future payment method.
- Each treasury has:
  - an **independent ledger** (append-only movements),
  - an **independent balance** — always **computed** from its ledger (`SUM(movements)`), never a
    stored balance column (consistent with ADR-0005 rule 6),
  - **independent reports**,
  - optional **open/close** capability if the business needs it (e.g. per shift/day).

### Transfers between treasuries

Moving money between treasuries must:

1. Be recorded as **two ledger movements**: a **debit** from the source treasury and a **credit** to
   the destination treasury.
2. **Never edit balances directly** — balances remain derived from movements.
3. Be **approvable/rejectable via F1** (draft/pending → approved → executed; reversal by new linked
   transaction, never delete/edit).
4. Produce a **full audit trail** for every transfer (who created/approved/rejected, timestamps,
   reasons), and the two movements must be linked to one transfer record.

### Payment-method ↔ treasury linkage (configuration, not code)

- Payment methods are **not** hard-wired to treasuries in code.
- A **settings layer** maps: **payment method → treasury**, editable from settings **without code
  changes**.
- Changing the mapping affects **future** movements only; historical ledger entries are immutable
  (F1).

## Consequences

- Data model (when implemented) gains: `treasuries` (type, open/close state, branch scope),
  `treasury_movements` (append-only, `treasury_id`, signed amount, source ref), `treasury_transfers`
  (source, destination, amount, F1 lifecycle fields, links to its two movements), and a
  `payment_method_treasury` mapping in settings.
- M4 designs treasuries + movements + transfers on this model; M6 posts payments to the treasury
  resolved via the settings mapping; M10 expenses debit the correct treasury; M12 reports read
  per-treasury ledgers.
- Balances are always trustworthy because they are computed, and every movement is traceable.

## Scope note (Planning Only)

No tables, RPCs, settings UI, or transfers are implemented now. This ADR fixes the principle so
upcoming financial modules are designed multi-treasury and configuration-driven from the start.

## Open items (resolve at M4 / F1 gate)

- Treasury scope: per branch vs per restaurant vs both.
- Whether open/close is per shift, per day, or manual.
- Transfer approval thresholds (ties into ADR-0005 approval matrix, `modules.md` Q6).
- Default seed treasuries and default payment-method mapping.
