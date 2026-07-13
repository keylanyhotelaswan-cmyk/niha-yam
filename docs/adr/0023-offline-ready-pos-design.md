# ADR-0023: Offline-ready POS design (deferred implementation)

**Status:** Accepted — **design only**; no offline sync in M5
**Date:** 2026-07-08
**Complements:** [ADR-0021](./0021-pos-thin-client-financial-core.md), [ADR-0010](./0010-performance-first-architecture.md).

## Context

M5 ships online-only POS for speed of delivery. The product owner requires that the **architecture**
still allows a future offline mode (local queue, local database, sync on reconnect) **without**
redesigning the financial schema, RPCs, or M4 ledger.

## Decision

1. **Sale Intent is a serializable, version-agnostic payload** (JSON) — the same shape whether sent
   immediately or replayed from a local queue later.
2. **`finalize_sale` remains the single write path** — online or offline-sync both call the same RPC;
   the server stays authoritative (ADR-0021).
3. **Optional future `client_request_id`** (nullable UUID on `orders`, unique when present) enables
   idempotent replay after sync without duplicate sales — column may be added in M5 schema as nullable
   unused until offline lands.
4. **POS client state** (cart) is already local-only; offline extends persistence (IndexedDB) without
   changing cart shape.
5. **No client-side ledger or balance logic** in offline mode — queued intents sync upward; M4 rules
   unchanged.

## Not in M5

Local queue, IndexedDB sale store, conflict resolution UI, or background sync worker.

## Consequences

- M5 implements online path only; tests use `finalize_sale` directly.
- Future offline module adds queue + sync layer; no fork of money logic.
