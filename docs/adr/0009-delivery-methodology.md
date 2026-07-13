# ADR-0009: Delivery methodology (Plan → Review → Approve → Implement → Test → Review)

**Status:** Accepted
**Date:** 2026-07-07
**Applies to:** the entire NIHA POS project, every module and foundation track.

## Context

The project owner wants a consistent, disciplined delivery loop for the whole lifecycle of NIHA POS,
not just the foundation phase. This mirrors how M1, U1 Steps 0–3, and Step 4 were run and makes the
expectation explicit and durable.

## Decision

Every unit of work (module or step within a module) follows this loop, in order:

1. **Plan** — produce a written plan/scope (and update relevant `docs/`).
2. **Review** — the owner reviews the plan.
3. **Approve** — no implementation begins before explicit approval.
4. **Implement** — build strictly within the approved scope; record ADRs for material decisions as
   they are made (docs-first).
5. **Test** — run quality gates (build, typecheck, lint, format) and functional/a11y/RTL checks.
6. **Review** — the owner reviews the result before the next unit starts.

**Hard rule:** we do not advance to a new step/module until the previous one is approved.

## Consequences

- Predictable, auditable progress with no scope creep.
- Slightly more up-front planning overhead, accepted deliberately for quality and control.
- Combined with docs-first (ADR-0001), every material decision leaves a written trail.
- This methodology is itself now part of the project's governance and is referenced by module plans.
