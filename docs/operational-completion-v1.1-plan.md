# Operational Completion v1.1 — Plan

**Status:** Implementing  
**Date:** 2026-07-13  
**After:** Shift Handover OES freeze · Ops polish 1.3–1.4  
**Outcome gate:** Test → Final Review → **Operational Freeze** → Purchasing  

---

## Scope (not new Capabilities)

| Slice | Deliverable |
| ----- | ----------- |
| **OC-1** | Receive cash-count + receive variance + archive |
| **OC-2** | Orders Hub = open shift only (action queue) |
| **OC-3** | Realtime invalidation (orders / payments / shifts / handovers) |
| **OC-4** | Order identity (created / edited / collected) |
| **OC-5** | Role `remote_operator` + Call Center workspace |
| **OC-6** | Ops messages (+ Bridge print `ops_message`) |
| **OC-7** | Print responsibility fields on order docs |

## Explicit non-goals

- Purchasing / inventory purchasing spine  
- New handover destinations  
- Changing receipt/kitchen **when** to enqueue (ADR-0030)  
- CRM beyond Call Center order entry  

## Freeze exceptions (narrow)

| Area | Allowed |
| ---- | ------- |
| Handover | Receive count + receive variance columns/RPC (cycle completion) |
| POS | `list_orders_for_pos` shift scope (V-A15) |
| M6 | New kind `ops_message` + enqueue + Bridge render only |
| Roles | `remote_operator` for Call Center entry |

## Q locks (product owner)

| ID | Lock |
| -- | ---- |
| Q-OC1 | Receive cannot confirm without actual cash count |
| Q-OC2 | Receive variance adjusts drawer via variance movement on **new** shift; stored on handover |
| Q-OC3 | Hub default = unpaid + partial + action for **open shift only**; no prior-shift paid |
| Q-OC4 | Realtime via Supabase `postgres_changes` + query invalidation |
| Q-OC5 | Identity: denormalized last_edited_* on orders; collected_* from latest payment |
| Q-OC6 | remote_operator: create/edit orders, no cash/treasury/refund/close |
| Q-OC7 | Ops message can target role/station; optional Bridge print |

---

## Exit

Final Review + **Operational Freeze**: bug / perf / UX only until Purchasing completes.
