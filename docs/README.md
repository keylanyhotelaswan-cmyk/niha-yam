# NIHA POS — Documentation

This folder is the **in-repo source of truth** for NIHA POS architecture, domain, workflows,
and design decisions. It is maintained **docs-first**: every material decision is recorded here
(and as an ADR) **as it is made**, not at the end of a module.

> The application UI is **Arabic-first / RTL**. This developer documentation is written in English
> for technical consistency with the codebase.

## Index

| Document                                               | Purpose                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [testing-environment.md](./testing-environment.md)     | إعداد بيئة Testing (محلي)                                                       |
| [deployment-workflow.md](./deployment-workflow.md)     | **Testing → Production** release gate · تقرير كل إصدار · [ADR-0036](./adr/0036-testing-first-deployment-workflow.md) |
| [architecture.md](./architecture.md)                   | System architecture: layers, folders, data flow, state, errors, security, secrets |
| [domain-model.md](./domain-model.md)                   | Entities, relationships, invariants, ER diagram                                   |
| [workflows.md](./workflows.md)                         | Business workflows — implemented now + designed for later                         |
| [m6-part-a-plan.md](./m6-part-a-plan.md)               | M6 Part A — ✅ Approved · M6A ✅ Approved                                      |
| [m6b-bridge-plan.md](./m6b-bridge-plan.md)             | M6B Bridge — ✅ Approved · absorbed into M6 Final Review                      |
| [m6-final-review.md](./m6-final-review.md)             | M6 Final Review — ✅ **Approved (2026-07-12)** · Printing feature freeze      |
| [m6-print-e2e-checklist.md](./m6-print-e2e-checklist.md) | Manual print E2E checklist                                                  |
| [m8-reports-plan.md](./m8-reports-plan.md)             | M8 Reports — ✅ Plan Approved · M8 ✅ **Approved** · Reports feature freeze |
| [m8a-final-review.md](./m8a-final-review.md)           | M8A slice review — absorbed into [m8-final-review.md](./m8-final-review.md) |
| [m8-final-review.md](./m8-final-review.md)             | M8 Final Review — ✅ **Approved (2026-07-12)** · Reports feature freeze · Operational V1.0 |
| [niha-erp-vision-2.0.md](./niha-erp-vision-2.0.md)     | **Phase 2** — NIHA ERP Vision 2.0 · ✅ **Approved (2026-07-12)** · S1 spine · [ADR-0033](./adr/0033-niha-erp-vision-2.0.md) |
| [recipes-costing-plan.md](./recipes-costing-plan.md)   | Phase 2 — Recipes & Costing · ✅ Plan Approved · RCA ✅ |
| [recipes-costing-final-review.md](./recipes-costing-final-review.md) | RCA Final Review — ✅ **Approved (2026-07-12)** · Recipes feature freeze |
| [inventory-plan.md](./inventory-plan.md)               | Phase 2 — Inventory Plan ✅ · INVA ✅ frozen · INVB ⏸ blocked |
| [inventory-final-review-inva.md](./inventory-final-review-inva.md) | INVA Final Review — ✅ **Approved (2026-07-12)** · **Inventory Feature Freeze (INVA)** · INVB not started |
| [shift-handover-oes-plan.md](./shift-handover-oes-plan.md) | **OES** — Shift Handover · ✅ Plan Approved · Implement done · [final review](./shift-handover-final-review.md) · [ADR-0034](./adr/0034-shift-handover-f1.md) |
| [shift-handover-final-review.md](./shift-handover-final-review.md) | Shift Handover Final Review — ✅ **Approved** · **Feature Freeze** · cash-count + receipt polish |
| [printing-architecture.md](./printing-architecture.md) | Printing system design — **implementation: M6** ([ADR-0029](./adr/0029-m6-printing-before-kds.md), [ADR-0030](./adr/0030-niha-print-bridge.md)) |
| [ux-guidelines.md](./ux-guidelines.md)                 | Unified UX conventions (drives the Design System page)                            |
| [modules.md](./modules.md)                             | Module sequence + status ledger                                                   |
| [adr/](./adr/)                                         | Architecture Decision Records — one file per decision                             |

## How this documentation is maintained

1. **Docs-first.** Before implementing a foundational choice, document it here and/or as an ADR.
2. **One decision = one ADR.** Material architectural/design decisions get an ADR at the moment
   they are made. Format: Context → Decision → Consequences → Status.
3. **Keep in sync with code.** When a module changes the schema, workflows, or architecture,
   update the relevant doc in the same change set.
4. **Future work is labeled.** Sections describing not-yet-built modules are explicitly marked as
   _designed / deferred_ so readers never mistake design for implementation.

## Current status

- **M0–M8** — Approved (see [modules.md](./modules.md))
- **M6 Printing** — ✅ Approved · **Printing feature freeze**
- **M7 KDS** — deferred
- **M8 Reports** — ✅ Approved · **Reports feature freeze**
- **Operational Version 1.0** — Phase 1 closed; live ops
- **Phase 2**
  - Vision 2.0 ✅
  - **Recipes (RCA)** ✅ + **Recipes Feature Freeze**
  - **Inventory (INVA)** ✅ + **Inventory Feature Freeze (INVA)**
  - **Live-ops window** — no new Phase 2 Implement; bug/UX inside freezes only
  - **Next kickoff TBD** from real ops — candidates: **INVB** or **Purchasing** (owner leans Purchasing; Vision allows reorder)

See [modules.md](./modules.md) for the full ledger.
