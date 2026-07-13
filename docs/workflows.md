# NIHA POS — Business Workflows

**Status:** Canonical (in-repo). Materialized from the approved workflows plan.
**Legend:** ✅ implemented · 🎯 designed / future module.

Each workflow is described with: **S** Start · **V** Validation · **D** DB changes · **OK** Success ·
**FAIL** Failure · **P** Permissions · **A** Audit.

## Global business rules

1. **Single transaction** — every financial workflow commits atomically or rolls back entirely.
2. **RPC-only writes** for `orders`, `payments`, `treasury_movements`, `expenses`, `shifts`.
3. **Idempotency** — all create/financial RPCs accept `idempotency_key`; replay returns cache.
4. **No optimistic financial state** — UI waits for RPC success.
5. **Computed balances** — treasury balance = `SUM(treasury_movements.amount)`; never a column.
6. **Shift binding** — `shift_id` attached before `process_payment`.
7. **Order numbers** — generated inside `create_order` via `branch_sequences` per branch/day.

---

## Implemented workflows (M1) ✅

### Auth — Email login

- **S** User submits email + password.
- **V** Credentials valid; `staff.is_active`; restaurant active.
- **D** Supabase Auth session; no app tables changed.
- **OK** JWT issued; staff profile loaded; redirect to admin.
- **FAIL** `AUTH_INVALID_CREDENTIALS` (generic), `AUTH_ACCOUNT_DISABLED`, `AUTH_NO_STAFF_RECORD`.
- **P** Public. **A** `auth.login` / `auth.login_failed` (no password).

### Auth — Logout

- **S** User clicks logout. **D** `signOut()`; clear Query cache. **OK** Redirect to login.
- **A** `auth.logout`.

### Auth — Password reset

- **S** User requests reset link. **V** Email exists. **D** Supabase sends reset email.
- **OK** "Check your email" (same message even if not found — security). **A**
  `auth.password_reset_requested`.

### Owner bootstrap (first owner)

- **S** Operator runs `pnpm bootstrap:owner --email --password --name` locally.
- **V** `staff` table empty (one-time only); service-role key present in `.env.local`.
- **D** `auth.admin.createUser` (service role) → RPC `bootstrap_owner_staff(user_id, name,
restaurant_id, branch_id)` → INSERT `staff` + `staff_branches` (role `owner`) + audit.
- **OK** Prints staff id + login URL. **FAIL** rolls back and deletes the auth user.
- **A** `staff.owner_bootstrapped`.
- **Why script not Dashboard:** reproducible, documented as code; service role never in frontend.

### Staff — Invite / accept

- **S** Owner/manager submits email, display name, branch assignments + roles.
- **V** Email not already active staff; ≥1 branch+role; valid roles.
- **D** INSERT `staff_invites` (token, expiry). On accept (signup with token) the auth trigger
  `handle_new_user` links invite → INSERT `staff` + `staff_branches`, marks `accepted_at`.
- **OK** Staff appears in list. **FAIL** `STAFF_EMAIL_EXISTS`, `INVITE_INVALID`,
  `INVITE_EMAIL_MISMATCH`. **P** owner, manager. **A** `staff.invited`, `staff.created`,
  `auth.signup_completed`.

### Staff — Update / deactivate / PIN

- Update profile & branch assignments (`staff.updated`); cannot remove last owner.
- Deactivate (`staff.deactivated`); `staff.is_active = false`.
- Set POS PIN (`staff.pin_set`); 4–6 digits, bcrypt in `pin_hash`; PIN never logged.
- **P** owner, manager (staff may edit own display name).

---

## Designed workflows (future modules) 🎯

High-level only; full 9-section specs live in the workflow plan and are added here as each module
ships.

- **POS PIN switch (M5):** cashier switches active staff on a terminal via PIN; audit
  `auth.pin_switch`.
- **Organization (M2):** create/update/deactivate branch; seed default treasury accounts +
  `branch_sequences` on branch create.
- **Settings & Menu (M3):** tax rates, payment methods, menu category/item/modifier CRUD, branch
  availability. Deactivate (never hard-delete) entities referenced by history.
- **Shifts & Treasury (M4):** open/close shift with cash count and computed `expected_cash`;
  pay-in/pay-out; treasury deposit/withdrawal/transfer (paired movements); expenses record/approve/
  void.
- **Orders & POS (M5):** create order → collect (pending) → approve → ledger; fulfillment independent;
  enqueue print jobs. See ADR-0024–0028.
- **Printing & Order Execution (M6):** receipt + kitchen paper on finalize; reprint + audit; durable
  queue — fire-and-forget, never block sales. See [printing-architecture.md](./printing-architecture.md)
  and [ADR-0029](./adr/0029-m6-printing-before-kds.md).
- **Kitchen Display (M7, deferred):** optional KDS consuming the same order events / print jobs.
- **Reports (M8):** ledger-based, compute-from-source reports.
- **Backlog:** inventory and other heavy modules after the operations loop.

---

## Cross-cutting

### Financial approval & reversal (principle — Planning Only) 🎯

Per [ADR-0005](./adr/0005-financial-approval-and-reversal-model.md), every balance-affecting
operation (bill collection, payment reversal, expense record/void, treasury deposit/withdrawal/
transfer, any balance adjustment) is **not final on execution**. It follows an explicit lifecycle
and is never edited or deleted:

```
draft → pending_approval → approved → executed → reversed (if undone)
        (some ops start directly at pending_approval)
```

Rules: no hard delete; no edit after execution; every undo is a **new reversal transaction** linked
to the original; every transition is audited with **who created / approved / rejected**, timestamps,
and reason. Balances stay computed from the ledger.

This is a **design principle now** — the financial modules (M4 Treasury, M5/M6 POS & Payments, M10
Expenses) will model their workflows on it, and the shared approval engine/UI is delivered under the
**F1 — Financial Approval Foundation** track (see `modules.md`). No implementation in U1.

### Offline queue (future, POS modules)

Queued actions (`create_order`, `process_payment`, `close_order`, `record_expense`) carry an
idempotency key; FIFO replay on reconnect; failed items surface a manual-resolution UI; queue never
deleted until server confirms.

### Audit logging

| Category           | Logged to                  | Trigger                           |
| ------------------ | -------------------------- | --------------------------------- |
| Auth / Staff (M1)  | `audit_log`                | RPC (`log_audit_event` allowlist) |
| Financial (M4+)    | `audit_log`                | RPC / DB trigger                  |
| Print reprint (M6) | `print_logs` + `audit_log` | RPC                               |

Never log passwords, PINs, or full card numbers.
