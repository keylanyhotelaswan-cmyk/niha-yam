# ADR-0035 — Production read-only for automated tests

**Status:** Accepted (2026-07-17)  
**Context:** A Production smoke script closed a live cashier shift (`SH-000006`) while promoting liquidity/handover features.

## Decision

Any script whose name matches **`smoke` / `test` / `simulation` / `fuzz` / `chaos`** must not mutate Production operational data.

### Allowed on Production

- Sign-in
- Read RPCs (`get_*`, `list_*`, `diagnose_*`, `verify_*`, `treasury_balance`, `liq_get_snapshot`, …)
- Health / connectivity checks
- Read-only smoke that asserts mutating RPCs are **blocked** by the client wrapper

### Forbidden on Production (unless owner override)

- Open/close shift
- Create/edit/cancel orders
- Expenses, purchases, supplier payments
- Treasury transfers / adjustments / approvals / reviews
- Any `INSERT` / `UPDATE` / `DELETE` via PostgREST
- Mutating RPCs (`close_shift`, `open_shift`, `finalize_sale`, `pur_*`, …)

### Where mutations are allowed

- **Testing project only** (`.env.testing` + `assertTestingTarget`)

### Console banners

When a protected script targets Production it prints first:

```
====================================
⚠️ PRODUCTION MODE
Read Only
====================================
```

When a write is attempted without the override:

```
====================================
❌ Production Write Blocked
To continue use:
NIHA_ALLOW_PROD_MUTATION=1
====================================
```

### Owner override

Only when the owner gives an **explicit separate command**:

```bash
NIHA_ALLOW_PROD_MUTATION=1 pnpm <script>
```

This must never be the default in CI or agent runs.

## Implementation

| Piece | Role |
| ----- | ---- |
| `scripts/script-safety.mjs` | Name detection, `refuseProductionMutations`, `createScriptClient` read-only proxy |
| `scripts/load-env.mjs` | `assertTestingTarget` / `assertProductionTarget` |
| Production `smoke-*-production.mjs` | Rewritten as read-only health checks |
| Mutative suites | Forced onto Testing (`loadTestingEnv`) |
| `pnpm verify:script-safety` | Static + unit verification of the policy |

## Consequences

- Production smokes no longer prove full money paths; those stay on Testing.
- Safer promote workflow: migrate/deploy Production, then read-only smoke + human check.
- Agents and CI cannot accidentally close live shifts again via named test scripts.
