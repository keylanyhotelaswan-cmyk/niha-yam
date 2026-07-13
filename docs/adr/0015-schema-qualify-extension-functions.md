# ADR-0015: Schema-qualify extension functions in SECURITY DEFINER RPCs

**Status:** Accepted
**Date:** 2026-07-07
**Applies to:** every SQL function/RPC in the project that calls an extension function (pgcrypto, etc.).

## Context

`create_staff_invite` failed at runtime with:

```
function gen_random_bytes(integer) does not exist
```

Root cause (not a missing extension):

- On Supabase, `pgcrypto` is pre-installed in the **`extensions`** schema, not `public`.
- `CREATE EXTENSION IF NOT EXISTS pgcrypto;` is a **no-op** when the extension already exists (an
  extension is a database-global object; `IF NOT EXISTS` skips entirely and ignores the target
  schema), so pgcrypto's functions remain in `extensions`.
- `gen_random_uuid()` works because in PostgreSQL 13+ it is a **core `pg_catalog`** function (not
  pgcrypto), so table PK defaults are fine.
- Our RPCs are `SECURITY DEFINER` with `SET search_path = public`. Unqualified calls to
  `gen_random_bytes()`, `crypt()`, and `gen_salt()` resolve only against `public` + `pg_catalog` —
  never `extensions` — so they are "not found". The same latent bug affected `set_staff_pin` and
  `verify_staff_pin`.

## Decision

**Always schema-qualify extension functions**, and keep `SECURITY DEFINER` functions on a minimal,
fixed `search_path`.

- Reference pgcrypto (and other extension) functions via the `extensions` schema, e.g.
  `extensions.gen_random_bytes(...)`, `extensions.crypt(...)`, `extensions.gen_salt(...)`.
- Keep `SET search_path = public` (or `= ''` with everything qualified) on `SECURITY DEFINER`
  functions. Do **not** widen `search_path` just to find extension functions — qualification is
  preferred because it removes reliance on search-path order and reduces search-path-hijack surface,
  which matters for the financial `SECURITY DEFINER` functions coming under F1.

### Rule for all future modules

Any RPC that uses an extension function must qualify it with `extensions.`. Core `pg_catalog`
functions (e.g. `gen_random_uuid()`, `now()`) need no qualification.

## Consequences

- Fix delivered as an append-only migration (`..._m1_fix_pgcrypto_schema.sql`) that
  `CREATE OR REPLACE`s the three affected functions with qualified calls. Original migrations are
  left untouched (already applied); a fresh `db reset` runs original → fix and ends in the correct
  state.
- New SQL reviews check for unqualified extension calls.
- No dependency on where `search_path` points for extension functions.

## Alternative considered

`SET search_path = public, extensions` (widen the path, keep calls unqualified). Rejected as the
default because a minimal, fixed `search_path` is safer for `SECURITY DEFINER` functions; explicit
qualification is clearer and order-independent.
