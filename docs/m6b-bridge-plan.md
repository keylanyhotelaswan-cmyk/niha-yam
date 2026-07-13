# M6B — NIHA Print Bridge (Plan Gate)

**Status:** ✅ **Approved** (2026-07-10) — BP-1…BP-15 + TTL + Print Center sole surface  
**Implement:** ✅ **M6B Approved** (2026-07-10) — schema/RPCs · .NET Bridge · `test:m6b` 32/32 · `test:m6` 43/43  
**M6 module:** ✅ **Approved (2026-07-12)** — [m6-final-review.md](./m6-final-review.md) · **Printing feature freeze**  
**Date:** 2026-07-10 · **Approved:** 2026-07-10 · **M6 closed:** 2026-07-12  
**Depends on:** M6A ✅ Approved · [ADR-0029](./adr/0029-m6-printing-before-kds.md) ·
[ADR-0030](./adr/0030-niha-print-bridge.md)  
**Methodology:** Plan → Review → Approve → Implement → Test → Final Review  
**Next after M6:** Plan gate for **M8 Reports** (M7 KDS remains deferred).

---

## 0. Approval record

| Item | Decision |
| ---- | -------- |
| **BP-1 … BP-11** | **Approved** |
| **Stack** | **.NET 8** Windows tray (not POS, not Electron, not browser-bound) |
| **Pairing** | Pair Code + QR; per-device Bridge identity |
| **Q-B1…Q-B5** | Accept recommendations (.NET 8, code+QR, SQLite, 1.5s poll, manager pair codes) |
| **BP-12 Print Job TTL** | **Approved** — default **5 minutes** |
| **BP-13 Send ≠ paper-out** | **Approved** — transport_ack vs device_confirmed |
| **BP-14 Print Center only** | **Approved** — sole admin home for all print settings (M6C UI) |
| **BP-15 No Bridge document copy** | **Approved** — template labels only; WYSIWYG |
| **M6 feature freeze** | No new features mid-M6; Backlog/ADR only → **Printing feature freeze** after Final Review |

No conflict with ADR-0029 / ADR-0030 (ADR-0030 amended for TTL).

| Slice | Status |
| ----- | ------ |
| **M6A** | ✅ Approved |
| **M6B** | ✅ Approved |
| **M6C** | ✅ Approved (Print Center + WYSIWYG / BP-15) — [m6-final-review.md](./m6-final-review.md) |

---

## 1. Objective

Standalone Windows tray Bridge that claims, renders, prints, and reports — with **TTL-bounded**
offline catch-up so reconnect never dumps a pile of stale kitchen tickets.

---

## 2. In / Out of scope

### In scope — M6B Implement

| Area | Deliverable |
| ---- | ----------- |
| .NET 8 tray | Installer, tray icon, Start with Windows |
| Pairing | Pair code / QR → token in Credential Manager; `print_bridges` identity |
| Worker | Poll ~1.5s; claim; render; print; report; **TTL check before print** |
| Multi-printer | One Bridge → many `printers` |
| Offline buffer | SQLite; sync results on reconnect **only if job not expired** |
| TTL | Setting + `expires_at` / status `expired`; no auto-print after TTL |
| Logs | Local rotating file |
| Auto-update hook | Version placeholder only |
| Cloud | Pair RPCs, bridge-token auth, TTL setting, expire job RPC/status |
| Tests | `pnpm test:m6b` including TTL scenarios |

### Out of scope — M6B (→ M6C)

| Item | Notes |
| ---- | ----- |
| **Print Center full UI** | Designed now (§4); built in **M6C** |
| Template drag-drop builder | Deferred forever until later phase |
| Full auto-update CDN | Later |
| KDS / Customer Display | M7+ consumers |

---

## 3. Architecture & TTL

### 3.1 Pipeline (unchanged)

```
Claim → Render → Print → Report
```

Bridge never knows Orders / Customers / Payments / Treasury / Ledger.

### 3.2 Offline (amended BP-4)

Local durable buffer **yes** — but **not unbounded auto-print on reconnect**.

### 3.3 Print Job TTL — **BP-12** (locked)

**Problem:** Net drops → cashier prints manually → 20 min later net returns → Bridge dumps all old jobs → paper waste + kitchen chaos.

**Policy:**

| Condition | Behaviour |
| --------- | --------- |
| Job age / time-in-queue **≤ TTL** and still pending/claimed/retry | Bridge **may** auto-print on reconnect |
| Job **exceeds TTL** before successful print | Status → **`expired`** (needs manual review) — **never** auto-printed |
| After `expired` | User must **Print Again** (new job) or **Ignore** (leave expired / cancel) |

**TTL setting** (restaurant print settings):

| Value | Meaning |
| ----- | ------- |
| `2` | 2 minutes |
| `5` | **Default** |
| `10` | 10 minutes |
| `0` / `never` | No expiry (legacy/opt-in only — not default) |

**Clock:** Prefer `expires_at = created_at + TTL` set at enqueue (and on Print Again). Bridge and server both refuse auto-execution past `expires_at`. A sweeper/RPC can mark `expired` when past due.

**Print Again** after expiry: creates a **new** `print_jobs` row with fresh `expires_at` (same as reprint/print_job_again semantics).

### 3.4 Duplicate ACK / restart

Unchanged: idempotent report; lease recovery on restart; expired jobs skipped by worker.

---

## 4. Print Center (design lock — implement UI in M6C)

> Not “printer settings only” — a full **Print Center** so the restaurant owns printing for years.

### 4.1 Modules inside Print Center

| Module | Capabilities |
| ------ | ------------ |
| **Printers** | Add / edit / deactivate; profile (width, encoding, copies, cut, drawer, logo, footer); Test Print; online status; last heartbeat/error; pending job count |
| **Templates** | Manage kinds: Receipt, Kitchen Ticket, Shift Report, Test Page, Delivery Receipt, … — **seed + version + activate**; **no Builder in M6**; structure ready for future editor |
| **Print settings** | Default copies, open drawer, cut, 58/80mm, orientation, logo, footer, thank-you, QR on/off, kitchen prices **off**, **TTL** (2/5/10/never) |
| **Preview** | Customer / kitchen / shift report / test page — WYSIWYG-ish from template+sample — no real order required |
| **Queue** | Pending · Printing · Failed · **Expired** · Completed — Retry / Print Again / Cancel (reason) / Ignore |
| **Health** | All printers + all Bridges: version, device, Windows user, last heartbeat, last job, last error |
| **Logs** | Print history: who, when, printer, copies, success/fail, reprint flag, bridge id |

### 4.2 Future-proof (no redesign)

Print Center / job kinds / printer roles already allow later: Label, Barcode, Kitchen sticker, Customer display, KDS as **consumers** of the same events/jobs.

### 4.3 Slice split

| Work | Slice |
| ---- | ----- |
| TTL columns, settings RPC, expire status, bridge respects TTL | **M6B** |
| Pairing + .NET Bridge | **M6B** |
| Print Center screens + i18n + wiring | **M6C** |

---

## 5. Repo layout (M6B)

```
apps/print-bridge/     # .NET 8 Windows tray — separate from Vite POS
```

---

## 6. Cloud deltas (M6B migrations)

| Change | Why |
| ------ | --- |
| `print_settings` (or restaurant jsonb) incl. `print_job_ttl_minutes` default 5 | TTL config |
| `print_jobs.expires_at` + status **`expired`** | BP-12 |
| `expire_stale_print_jobs` / claim skips expired | Server + Bridge |
| `pair_print_bridge` + token auth on claim/report/heartbeat | BP-3 |
| `printers.bridge_id` optional | Ownership |
| Lease TTL for stale `claimed` | Restart recovery |

---

## 7. `pnpm test:m6b` scenarios

| # | Scenario |
| - | -------- |
| 1 | Pair Bridge |
| 2 | Claim jobs |
| 3 | Offline **&lt; TTL** → auto resume print |
| 4 | Offline **&gt; TTL** → jobs **`expired`**, **no** auto-print |
| 5 | Print Again after expired → new job prints normally |
| 6 | Retry / Cancel / Heartbeat |
| 7 | Multiple printers on one Bridge |
| 8 | Printer offline |
| 9 | Queue recovery / Bridge restart |
| 10 | Duplicate ACK |
| 11 | Test Print |
| 12 | Reprint + reason |

---

## 8. Locked policies

| ID | Policy |
| -- | ------ |
| **P-B1** | .NET 8 standalone tray; BP-1…BP-11 |
| **P-B2** | No service_role in Bridge |
| **P-B3** | No business/financial logic in Bridge |
| **P-B4** | Browser close does not stop Bridge |
| **P-B5** | **TTL default 5 min**; expired never auto-prints; Print Again is explicit |
| **P-B6** | Print Center is the **only** print admin surface (BP-14); UI in **M6C** |
| **P-B7** | M6C blocked until M6B Final Review green |
| **P-B8** | Send success ≠ paper-out (BP-13); report `delivery` honestly |
| **P-B9** | **M6 feature freeze** — no scope adds during Implement; Backlog/ADR only |

---

## 9. Implement kickoff

**M6B Plan is Approved.** Implementation order:

1. Schema/RPC: TTL + `expired` + print settings + pairing token auth  
2. .NET 8 Bridge MVP (pair, claim, print, report, TTL, offline buffer)  
3. `pnpm test:m6b` green  
4. Final Review → then **M6C Print Center UI**
