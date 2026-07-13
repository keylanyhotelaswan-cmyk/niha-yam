# ADR-0030: NIHA Print Bridge — standalone Windows executor

**Status:** Accepted (2026-07-10) · **Amended 2026-07-11** — Bridge = execution agent; Print Center owns assignment / Test Print / queue; **document-type enqueue policy** (kitchen@create, receipt@collection); **Amended 2026-07-11 (BP-15)** — Bridge has **zero hardcoded document copy**  
**Date:** 2026-07-10  
**Complements:** [ADR-0029](./0029-m6-printing-before-kds.md), [ADR-0031](./0031-draft-orders-db-direction.md), [m6-part-a-plan.md](../m6-part-a-plan.md),
[m6b-bridge-plan.md](../m6b-bridge-plan.md), [printing-architecture.md](../printing-architecture.md).

## Context

M6A delivered Postgres `print_jobs` as intent/lifecycle SSOT. Real Windows printing needs a local
agent. Unbounded offline catch-up would reprint a backlog of stale kitchen tickets when the network
returns — unacceptable in a live restaurant. Hardware also lies: “bytes accepted by the driver”
is not the same as “paper came out.”

After M6B/C field use: local Bridge Test Print worked while Print Center Test Print did not,
because printer registry lacked `windows_printer_name` / `bridge_id` and Bridge discovery was not
reported to the cloud. That blurred admin vs execution — corrected below.

POS sales still inserted bare M5 `print_jobs` (no printer routing / snapshot), so Test Print worked
while real orders did not reach the configured thermal printer — closed with document-type enqueue.

## Decision

> **NIHA Print Bridge** is a **standalone .NET 8 Windows tray application**. It is the only process
> that talks to printers. The POS never opens hardware. The Bridge never contains business/financial
> logic **nor printer administration**. Offline catch-up is **TTL-bounded**. Print admin UX lives only in **Print Center**.

### Document-type auto-print policy (locked)

| Event | Kitchen job | Customer receipt job |
| ----- | ----------- | -------------------- |
| Order create with kitchen items | Yes | No (unless Pay Now) |
| Pay Now (`finalize_sale`) | Yes if kitchen items | Yes |
| Later / partial collection (`record_collection`) | No | Yes |
| Unpaid create only | Kitchen only | Never at create |

Enqueue goes through `m6_enqueue_document_print` (stamps `printer_id`, `bridge_id`, template,
`data_snapshot`). Reprint is **document-type** (receipt / kitchen / both) with required reason →
timeline + audit.

### Responsibility split (locked)

| Surface | Owns |
| ------- | ---- |
| **Print Bridge** (execution agent) | Discover Windows printers; pair + heartbeat; claim → render → print → report; send inventory + status. No role assignment, no queue admin, no template binding. |
| **Print Center** (sole admin) | Bridges list; discovered devices; assign role; bind Windows printer + bridge; Test Print; Retry / Print Again / Cancel; templates; settings; health; official Bridge download. |

**Test Print path:** Print Center → `enqueue_test_print` → `print_jobs` → Bridge → Printer.

### Locked principles (BP-1 … BP-14)

| ID | Principle |
| -- | --------- |
| **BP-1** | Standalone Windows tray — not POS, not Electron-POS, not browser-dependent |
| **BP-2** | Optional **Start with Windows** |
| **BP-3** | Pairing via Pair Code / QR / token — **never** embed `SUPABASE_SERVICE_ROLE_KEY` |
| **BP-4** | Offline local buffer **yes** — but auto-print on reconnect **only within TTL** (see BP-12) |
| **BP-5** | One Bridge → **multiple** printers |
| **BP-6** | Local error logs |
| **BP-7** | Auto-update-ready structure (implement later) |
| **BP-8** | Closing the browser does **not** stop the queue |
| **BP-9** | Per-machine Bridge identity: device, heartbeat, version, printers |
| **BP-10** | Pipeline only: **Claim → Render → Print → Report** — no Orders / Payments / Ledger / Treasury / Customers |
| **BP-11** | `pnpm test:m6b` includes pair, claim, offline, TTL, expired, Print Again, retry, heartbeat, multi-printer, recovery, duplicate ACK, restart |
| **BP-12** | **Print Job TTL** — default **5 minutes** (setting: 2 / 5 / 10 / never). Past TTL → status **`expired`**; **no auto-print**; user must **Print Again** or Ignore |
| **BP-13** | **Send success ≠ paper-out success.** Transport accepted ≠ paper out unless `device_confirmed` |
| **BP-14** | **Print Center is the only admin home for printing** — Bridge UI is diagnostic/execution only |
| **BP-15** | **Bridge contains no document copy.** No hardcoded strings such as Kitchen Ticket / Total / Discount / Paid (or Arabic equivalents). All printable labels come from the **document layout template** (`label_ar` / `label_en` / `label_mode` / `value_format`). Preview and paper must match (WYSIWYG); any mismatch is a bug. Language and restaurant-specific wording change without Bridge code changes. |

### M6 feature freeze

**Closed:** M6 module Approved 2026-07-12 — see [m6-final-review.md](../m6-final-review.md).  
Ongoing: **Printing feature freeze** (bug / perf / UX only). No new print product features without a new Plan cycle.

### Data flow

```
POS / Orders (create · Pay Now · collection · reprint by document type)
        │  m6_enqueue_document_print
        ▼
Postgres printers + print_jobs (SSOT)
        │
        ▼
Bridge (claim → render data_snapshot → print → report)
```

## Consequences

- Kitchen paper follows fulfillment; customer receipt follows money.
- Operators manage printing from Print Center; Bridge stays a thin execution agent.
- **BP-15:** restaurant wording / language customization is template-only; Bridge stays locale-agnostic for documents.
- No conflict with ADR-0029 (KDS remains a future consumer of the same jobs/events).
