# Shift Handover — Operational Enhancement Sprint (OES) Plan

**Status:** ✅ **Approved** (2026-07-13) — Implement SHA → SHB → SHC authorized  
**Date:** 2026-07-13 · **Approved:** 2026-07-13  
**Type:** Operational Enhancement Sprint (not a new Phase 2 Capability)  
**Domain:** Treasury / Shifts (M4) + cashier Orders Hub (M5 surface, UX only)  
**Phase Vision:** [NIHA ERP Vision 2.0](./niha-erp-vision-2.0.md) §4.8.5 · **V-A14…V-A24**  
**ADR:** [ADR-0034](./adr/0034-shift-handover-f1.md) ✅ Accepted  
**Depends on:** M4 Treasury ✅ · M5 POS ✅ · Vision handover locks ✅  
**Respects freezes:** POS · Printing · Reports · Recipes · INVA — ops enhancement only  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review

---

## Approval record

| Item | Decision |
| ---- | -------- |
| **Plan** | ✅ **Approved** (2026-07-13) |
| **Q-SH1** | ✅ Shift → **Closed** immediately on destination choice + create **Pending Handover** |
| **Q-SH2** | ✅ New shift may open while Path A (admin) handover still **Pending** |
| **Q-SH3** | ✅ Mid-shift **Cash Drop** allowed only when **no** Pending Handover exists |
| **Q-SH4** | ✅ Handover amount = final drawer balance **after** approved variance on close |
| **Q-SH5** | ✅ Each handover has independent **reference**; linked to shift, timeline, audit |
| **Q-SH6** | ✅ Path B: next-cashier **Receive = Approve** (final transfer/link) |
| **Q-SH7** | ✅ Path A receive only by **manager / owner** (Treasury permission) |
| **Q-SH8** | ✅ Reject → cash stays in drawer; **reason required**; may **re-request** handover later |
| **Q-SH9** | ✅ Pending notifications stay visible until receive or reject — **not dismissible** |
| **Q-SH10** | ✅ Shift Archive retains full handover + receive detail on the shift record |
| **Implement** | ✅ **SHA → SHB → SHC** done · cash-count + receipt polish |
| **Feature Freeze** | ✅ **Shift Handover Feature Freeze** (2026-07-13) — bug / perf / UX only |

### Locked principles (Vision)

V-A14…V-A24 as in Vision §4.8.5.

---

## Slices

| Slice | Contents | Status |
| ----- | -------- | ------ |
| **SHA** | Schema, RPCs, close + handover UX, receive/reject, bypass locks, notifications | Implement |
| **SHB** | Orders Hub action-queue filter | Implement |
| **SHC** | Shift Archive admin | Implement |

---

## In scope

Close → choose Admin/Main **or** Next shift only · Pending → Receive → Transfer · Orders Hub filter · Shift Archive · no DB delete · F1 locks while pending.

## Out of scope

Purchasing · INVB · Retention purge · Treasury core redesign · silent Main credit on close.

---

## Document control

| Version | Date | Notes |
| ------- | ---- | ----- |
| 0.1 | 2026-07-13 | Draft |
| **1.0** | **2026-07-13** | Approved — Q-SH1…10 locked · Implement authorized |
| 1.1 | 2026-07-13 | Product-owner Q-SH set (receive/ref/re-request/notifications/archive) |
