# ADR-0001: Record architecture decisions

**Status:** Accepted
**Date:** 2026-07-07

## Context

NIHA POS is built module by module and is intended to be maintained for 10+ years. Decisions made
during one module affect all later modules. The team agreed to document architectural decisions
**as they are made** (docs-first), not retroactively.

## Decision

We keep an Architecture Decision Record (ADR) log in `docs/adr/`. One file per decision, named
`NNNN-title.md`. Each ADR uses the format: **Context → Decision → Consequences → Status**.

A "material decision" that warrants an ADR includes: changes to the data model or auth, choice of a
core library/technology, cross-cutting UX or styling rules, and any tradeoff that later modules will
depend on.

**Rule:** no implementation step proceeds past a foundational decision until its ADR exists.

## Consequences

- New contributors can understand _why_ the system is shaped the way it is.
- Reversing a decision means adding a superseding ADR, not silently changing code.
- Slightly more upfront writing; offset by fewer re-litigated decisions.
