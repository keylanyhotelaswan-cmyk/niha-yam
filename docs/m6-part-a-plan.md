# M6 Part A — Printing & Order Execution (Plan Gate)

**Status:** ✅ **Approved** (2026-07-10) — product owner locked P-1…P-10, B1…B8 recommendations, and operational amendments below
**Date:** 2026-07-10 · **Approved:** 2026-07-10
**Module:** M6 — Printing & Order Execution ([ADR-0029](./adr/0029-m6-printing-before-kds.md))
**Baseline design:** [printing-architecture.md](./printing-architecture.md) (amended by this Part A)
**Depends on:** M5 Approved + POS feature freeze
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review (same as M5)

> **Implement order:** **M6A** (schema + RPCs + registry + queue lifecycle) → Review → **M6B** (Bridge) →
> **M6C** (templates polish + Health/Reprint UI + `test:m6` full). No Bridge/UI hardware in M6A.

---

## Approval record

| Item | Decision |
| ---- | -------- |
| **P-1 … P-10** | **Approved as written** |
| **B1 … B8** | **Accept all recommendations** (standalone Bridge, pairing token, poll MVP, kitchen print on create, Web Print emergency-only) |
| Template editor | **Out** — seed `Receipt v1` + `Kitchen Ticket v1` only |
| Next slice | **M6A only** |

### Operational amendments (locked at Approve)

| ID | Amendment |
| -- | --------- |
| **A1** | **Printer Profile** on each printer: name, type, role, paper width, encoding, default copies, auto-cut, open cash drawer, logo, footer — so templates stay role-based, not per-device forks |
| **A2** | **Test Print** from Health — small page: printer name, time, version, connection type |
| **A3** | **Template Preview** (read-only) — customer + kitchen as they will print, without a real order |
| **A4** | **Printer roles enum (open):** `cashier` · `kitchen` · `bar` · `dessert` · `label` · `receipt` · `other` (+ future kinds without core rewrite) |
| **A5** | **Manual queue actions:** Retry · Cancel (reason required) · Print Again |
| **A6** | **Bridge status** on Health: version, last heartbeat, device name, Windows username, last connect, last restart |
| **A7** | Architecture ready for Label / Barcode / Kitchen sticker / Delivery label jobs without core changes |
| **A8** | `pnpm test:m6` must cover: create jobs, auto-print enqueue, retry, offline queue, reprint, audit, timeline, health, failure recovery — M6 not closed until all green |

---

## 1. Objective

Make the real restaurant workflow reliable:

> Cashier finalizes → **two papers print** (kitchen + customer) without cashier taps → if the
> printer fails, the **sale still succeeds** and the job **retries** until printed or manually
> resolved.

M6 **executes** print intent that M5 already enqueues (`print_jobs`, `kitchen_tickets`,
`reprint_order`). It does **not** reopen POS financial scope.

Future **M7 KDS** only **consumes** the same Order Events + Print Jobs — never a second SSOT.

```
Finalize Sale / Order create (M5 RPCs — unchanged money path)
        │
        ▼
Create Print Jobs (Postgres intent SSOT)
        │
        ▼
Claim / Queue (local Bridge worker)
        │
        ▼
Render Template → Transport → Printer
```

---

## 2. In / Out of scope

### In scope — M6 (six pillars + amendments)

| # | Pillar | Outcome |
| - | ------ | ------- |
| 1 | **Printer Registry + Profile** | CRUD + profile fields (A1); roles enum open (A4) |
| 2 | **Printing Bridge** | Local Windows agent (M6B); status fields (A6) |
| 3 | **Print Queue** | Durable jobs; Retry / Cancel / Print Again (A5) |
| 4 | **Templates** | Seed Receipt v1 + Kitchen v1; **preview** read-only (A3); **no editor** |
| 5 | **Reprint** | New job + reason → timeline + audit; no new order |
| 6 | **Printer Health** | Online, pending, errors, retry + **Test Print** (A2) + Bridge status (A6) |

### Explicitly out of scope

| Item | Where |
| ---- | ----- |
| Kitchen Display UI / Realtime bump board | **M7** |
| Full visual template editor (drag-drop) | **Deferred** (A8 / later phase) |
| Multi-station department routing | Phase 2 — roles ready now |
| Bridge binary / real hardware I/O | **M6B** (not M6A) |
| Admin/POS print UI screens | **M6C** (M6A = RPCs only; optional thin smoke via tests) |
| Reopening M5 money rules | **Forbidden** |
| Absorbing ADR-0026 into printing | **Forbidden** |

### POS freeze exception (narrow)

M6 may add **print-only** hooks on existing POS/order screens (M6C):

- Reprint dialog (reason required)
- Print status badge / failed-job toast (non-blocking)
- No cart, payment, or ledger changes

---

## 3. Architecture (Part A lock)

### 3.1 Separation of concerns

| Layer | Owns | Must not own |
| ----- | ---- | ------------ |
| **Order RPCs (M5)** | Create order + enqueue `print_jobs` with snapshot | Hardware, templates render, bridge |
| **Postgres** | Job **intent** + status + audit + printer config + templates | Raw ESC/POS bytes to device |
| **Print Bridge (local)** | Claim pending jobs, render, send, report result/health | Business rules, money, order create |
| **Admin / POS UI** | Registry, health, reprint, queue visibility | Direct printer I/O |

### 3.2 Queue SSOT decision (amends early IndexedDB-only note)

**Locked proposal for Review:**

| Store | Role |
| ----- | ---- |
| **`print_jobs` (Postgres)** | **Intent + lifecycle SSOT** — created by RPCs; visible to all terminals/managers; KDS-ready |
| **Bridge local buffer** | Short-lived claim/work buffer only (crash recovery re-claims from Postgres) |
| **`print_attempts` / `print_logs`** | Append-only attempt history (each try) |

Rationale: manager Health UI and multi-terminal need a shared job list; IndexedDB-only queue on one
browser tab cannot be the restaurant SSOT. Cloud still **never** opens USB/LAN — only the Bridge
does.

### 3.3 Job lifecycle (extended from M5 enums)

M5 today: `pending` · `completed` · `failed`.

**Approved lifecycle:**

```
pending → claimed → printing → completed
                ↘ retry_wait → pending (backoff)
                ↘ failed (max retries or non-retryable)
failed → pending (manual retry / print again)
* → cancelled (manual cancel + reason)
```

| Status | Meaning |
| ------ | ------- |
| `pending` | Waiting for any healthy Bridge |
| `claimed` | Bridge holds lease (`claimed_by`, `claimed_at`, lease TTL) |
| `printing` | Bytes sent / in flight |
| `completed` | Hardware ACK / spooler success |
| `retry_wait` | Transient failure; next attempt after backoff |
| `failed` | Exhausted retries or permanent error; needs human |
| `cancelled` | Manager cancelled with reason (A5) |

Backoff: 2s → 5s → 15s → 30s → 60s → failed.

**Manual queue (A5):** `retry_print_job` · `cancel_print_job(reason)` · `print_job_again` (clone pending job from completed/failed/cancelled).

**Idempotency:** Bridge sends `attempt_id`; duplicate ACK does not double-complete.

### 3.4 Auto-print path (no cashier taps)

On successful `finalize_sale` / kitchen-needed create (already in M5):

1. Insert `print_jobs` rows: `kind=receipt` + `kind=kitchen` (when kitchen needed).
2. Payload includes **immutable `data_snapshot`** (order lines, modifiers, notes, money for receipt only).
3. Order `print_status` → `pending`.
4. Bridge polls / Realtime subscription → claim → print both.
5. On all required jobs `completed` → order `print_status = done`; any terminal `failed` → `failed`.

Sale RPC **returns before** any hardware I/O.

### 3.5 Future KDS (non-negotiable)

```
Order Events + Print Jobs
        │
   ┌────┴────┐
   │         │
   ▼         ▼
 Printing     KDS (M7)
```

No parallel “kitchen board state” table as SSOT in M6.

---

## 4. Schema (proposed — Implement only after Approve)

### 4.1 Extend existing

| Object | Change |
| ------ | ------ |
| `print_jobs` | Add: `printer_id`, `template_id`, `template_version`, `is_reprint`, `reprint_reason`, `reprint_of_job_id`, `attempt_count`, `next_attempt_at`, `claimed_by`, `claimed_at`, `last_error`, `completed_at`, richer `payload.data_snapshot` |
| `print_job_status` | Expand enum (or text + check) per §3.3 |
| `print_job_kind` | Keep `receipt` · `kitchen`; allow future kinds without breaking |
| `orders.print_status` | Drive from job aggregate (RPC helper) |
| `reprint_order` | Require `p_reason`; stamp reprint metadata; timeline + audit |

### 4.2 New tables

| Table | Purpose |
| ----- | ------- |
| `printers` | Registry + **Printer Profile (A1):** name, `device_type`, `role`, paper_width_mm, encoding, default_copies, auto_cut, open_cash_drawer, logo_url, footer_text, connection, address jsonb, is_active |
| `print_templates` | Seed only: `receipt` v1, `kitchen` v1 — versioned `body` jsonb; **no editor** |
| `print_role_defaults` | Maps `printer_role` → default `printer_id` (+ optional template) |
| `print_attempts` | Append-only attempt history |
| `print_bridges` | Bridge instances: version, device_name, windows_username, last_heartbeat_at, last_connected_at, last_restart_at (A6) |

### 4.3 Job kinds (extensible — A7)

`print_job_kind`: `receipt` · `kitchen` · `test_page` · `label` · `barcode` · `kitchen_sticker` · `delivery_label` (+ add values later without core rewrite)

### 4.4 Seed (Niha Yam MVP)

- Roles ready: cashier + kitchen printers (inactive until configured) or placeholders.
- Templates: `Receipt v1`, `Kitchen Ticket v1` (Arabic blocks).
- No department routing in M6A.

---

## 5. RPCs (approved surface)

| RPC | Actor | Behaviour |
| --- | ----- | --------- |
| `list_printers` / `upsert_printer` / `set_printer_active` | Manager | Registry + profile |
| `list_print_templates` / `get_print_template` / `preview_print_template` | Manager | Read + **preview** (A3); no upsert editor in M6 |
| `list_print_jobs` | Manager | Filter by status, order, printer |
| `get_printer_health` | Manager | Online, last success, pending, last error + **bridge status** (A6) |
| `enqueue_test_print` | Manager | Test page job (A2) |
| `claim_print_jobs` | Bridge token | Lease pending jobs (M6A exists for tests; Bridge uses in M6B) |
| `report_print_attempt` | Bridge token | Append attempt; update job status |
| `retry_print_job` | Manager | failed/retry_wait → pending |
| `cancel_print_job` | Manager | reason required → cancelled |
| `print_job_again` | Manager | Clone job as new pending (Print Again) |
| `reprint_order` | Cashier/Manager | **Extend:** `p_reason` required |
| `get_order_print_summary` | Staff | Counts + reprint meta |
| `upsert_print_bridge_heartbeat` | Bridge | A6 fields |

M5 finalize paths: enrich snapshot when touching print enqueue (M6A may patch payload builder only).

---

## 6. Printing Bridge (Part A design)

### 6.1 Responsibilities

1. Discover Windows printers / configured LAN targets.
2. Maintain connection + auto-reconnect.
3. Heartbeat → `printers` / health RPC.
4. Claim jobs for printers this terminal owns.
5. Render template → ESC/POS or spooler payload.
6. Report success/failure with error codes (`OFFLINE`, `NO_PAPER`, `TIMEOUT`, …).

### 6.2 What POS must not know

- TCP ports, USB paths, ESC/POS bytes, Windows printer names (except as opaque config in admin).

POS/Admin only: pick printer from registry, see health, trigger reprint/retry.

### 6.3 MVP transport matrix

| Transport | MVP |
| --------- | --- |
| Windows Spooler (named printer) | **Yes** |
| LAN RAW 9100 | **Yes** |
| USB via Bridge | **Yes** if spooler path insufficient |
| Web Print HTML fallback | **Yes** (dev / emergency only) |
| Bluetooth / vendor ePOS SDK | Phase 2 |

### 6.4 Multi-printer

One Bridge instance per cashier PC can drive **multiple** logical `printers` rows (cashier + kitchen
on same machine, or kitchen on LAN). Jobs for different printers run **concurrently**; same printer
**serially**.

---

## 7. Templates (content lock)

### 7.1 Customer receipt (`receipt`)

| Block | Required MVP |
| ----- | ------------ |
| Restaurant name / phone / address | Yes |
| Order reference + datetime | Yes |
| Order type | Yes |
| Customer name/phone (if any) | Yes |
| Line items + prices + qty | Yes |
| Modifiers (priced if any) | Yes |
| Subtotal / discount / total | Yes |
| Tax | Placeholder / hidden until Q2 |
| Payment methods + amounts | Yes |
| Change | Yes |
| QR (order ref) | Optional flag |
| Thank-you footer | Yes |

### 7.2 Kitchen ticket (`kitchen`)

| Block | Required MVP |
| ----- | ------------ |
| Order reference (large) | Yes |
| Order type (dine-in / takeaway / delivery) | Yes |
| Time + cashier | Yes |
| Items + qty | Yes |
| Modifiers | Yes |
| Line / order notes | Yes |
| **Prices** | **Never** |
| Payment / change | **Never** |

Thermal width: 80mm default; 58mm optional later.

### 7.3 Engine

- Versioned JSON block tree (as in printing-architecture).
- Renderers: ESC/POS builder + HTML preview for admin.
- Reprint uses **template_version frozen on the job** (or re-snapshot — prefer frozen snapshot).

---

## 8. Reprint (policy lock)

| Rule | Policy |
| ---- | ------ |
| Entry | Order detail only (not a silent second finalize) |
| Creates | New `print_jobs` row(s) with `is_reprint=true` |
| Does not create | New order / new collection / ledger movement |
| Reason | **Required** (non-empty) |
| Audit | `order.reprinted` + order_events `print.enqueued` with reprint meta |
| Visibility | Timeline shows actor, time, kind, reason; detail shows reprint count |

---

## 9. Printer Health (UI lock)

Admin screen (treasury/settings area or `/printing`):

| Widget | Source |
| ------ | ------ |
| Printer online / offline | Last heartbeat age |
| Last successful print | Max completed_at |
| Pending / retry / failed counts | `print_jobs` aggregate |
| Last error | `last_error` / latest attempt |
| Actions | Retry failed job; open job list; test page |

Cashier: non-blocking toast if kitchen/receipt job fails after N retries — never modal that blocks selling.

---

## 10. UI routes & screens (Implement after Approve)

| Screen | Audience |
| ------ | -------- |
| Printers list + upsert | Manager |
| Template preview (read-only MVP) | Manager |
| Print queue / job list | Manager |
| Printer health dashboard | Manager |
| Reprint dialog on order detail | Cashier / Manager |
| Bridge pairing / status indicator | Manager (setup) |

---

## 11. Workflows covered

1. Pay-now sale → auto receipt + kitchen print.
2. Pay-later / delivery create with kitchen need → kitchen print (receipt when collected — policy in OQ).
3. Printer offline during rush → jobs queue → auto-retry → papers catch up.
4. Reprint customer or kitchen with reason.
5. Manager diagnoses “no paper came out” via Health.
6. (Future) KDS reads same jobs/events — no M6 redesign.

---

## 12. Acceptance criteria (Final Review checklist)

- [ ] Finalize never waits on printer; sale succeeds if Bridge down.
- [ ] Two jobs enqueued when kitchen needed; snapshots complete.
- [ ] Offline printer: jobs remain visible; auto-retry; no job loss on refresh.
- [ ] Customer template has money; kitchen has **zero** prices.
- [ ] Reprint requires reason; timeline + audit; reprint count correct.
- [ ] Health shows online, pending, last error, retry + test print + bridge status.
- [ ] Manual queue: retry / cancel(reason) / print again.
- [ ] POS has no direct hardware calls.
- [ ] `pnpm test:m4` / `m5` / `m5b` / `m5c` stay green; `test:m6` covers A8 scenarios.
- [ ] No M5 financial regressions; freeze respected.

---

## 13. Open questions — **resolved at Approve**

| ID | Resolution |
| -- | ---------- |
| **B1** | Paired device token per terminal (hashed); not service_role in installer |
| **B2** | Standalone Windows tray app for MVP |
| **B3** | Per-vendor default in `printers.encoding` / address jsonb |
| **B4** | Merchant copy off by default |
| **B5** | Kitchen print on create; receipt on collection / finalize as today |
| **B6** | Cashier + Manager may reprint; reason always required |
| **B7** | Poll 1–2s in MVP |
| **B8** | Web Print = emergency/dev only |

---

## 14. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Bridge not installed → silent no paper | Health “Bridge offline” + cashier toast after delay |
| Dual queue confusion | Postgres SSOT; local buffer not authoritative |
| Snapshot drift on reprint | Freeze snapshot on job; reprint builds fresh snapshot from current order |
| Scope creep into KDS | ADR-0029 + Out of scope table |
| POS freeze erosion | Print-only UI hooks listed explicitly |

---

## 15. Locked policies — **Approved**

| ID | Policy |
| -- | ------ |
| **P-1** | Printing never blocks or rolls back a successful sale. |
| **P-2** | Postgres `print_jobs` is intent/lifecycle SSOT; Bridge is executor only. |
| **P-3** | Auto-print: receipt + kitchen on finalize when kitchen needed — zero cashier taps. |
| **P-4** | Kitchen template never includes prices or payments. |
| **P-5** | Reprint = new job + required reason + timeline + audit; never a new order. |
| **P-6** | Failed/offline → retain + auto-retry + Health visibility. |
| **P-7** | POS/UI never opens printer hardware; only Bridge does. |
| **P-8** | M7 KDS consumes same events/jobs; M6 does not build a second kitchen SSOT. |
| **P-9** | ~~No migrations until Approved~~ → **lifted**; Part A Approved 2026-07-10. |
| **P-10** | M5 POS feature freeze holds except narrow print UX hooks in §2. |

---

## 16. Implementation slices

| Slice | Content | Status |
| ----- | ------- | ------ |
| **M6A** | Schema + RPCs + registry + queue lifecycle + claim/report (no hardware) + `test:m6` core | ✅ **Approved** (2026-07-10) — now 43/43 |
| **M6B** | Standalone .NET 8 Bridge + Print Job TTL + pairing ([m6b-bridge-plan.md](./m6b-bridge-plan.md)) | ✅ **Approved** (2026-07-10) — 32/32 |
| **M6C** | **Print Center** UI + layout WYSIWYG / BP-15 ([m6-final-review.md](./m6-final-review.md)) | ✅ **Approved** (2026-07-12) |

## 17. Approval

**Part A Approved 2026-07-10** with amendments A1–A8.  
**M6 module Approved 2026-07-12** — Printing feature freeze; next Plan = M8 Reports (M7 deferred).

