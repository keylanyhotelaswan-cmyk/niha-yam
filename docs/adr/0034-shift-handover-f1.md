# ADR-0034: Shift Handover under F1 (Operational Enhancement)

**Status:** Accepted (2026-07-13)  
**Date:** 2026-07-13  
**Complements:** [ADR-0005](./0005-financial-approval-and-reversal-model.md) (F1), [ADR-0033](./0033-niha-erp-vision-2.0.md),
Vision §4.8.5 (**V-A18…V-A24**), [shift-handover-oes-plan.md](../shift-handover-oes-plan.md).

## Context

Live ops showed that treating Cash Drop as an optional side path at close breaks the restaurant trust
cycle. Vision locked Shift Handover; this ADR accepts the OES Plan with locked Q-SH1…Q-SH10.

## Decision

1. **Close shift** → choose **Admin/Main** or **Next shift** only → shift **Closed** + **Pending Handover**.  
2. Lifecycle: **Pending → Receive → Transfer** (F1; append-only ledger). Path B: **Receive = Approve**.  
3. Path A receive: **owner/manager** only.  
4. Amount = drawer balance **after** close variance.  
5. Independent **handover reference**; audit + shift timeline.  
6. Reject: cash stays in drawer; reason required; **re-request** allowed later.  
7. While any **Pending** handover exists: no Cash Drop, no second pending for same shift, no shift-cash Main bump.  
8. Notifications non-dismissible until resolved.  
9. Orders Hub = action queue; Shift Archive holds history — **no DB purge**.

## Consequences

- Close-path Cash Drop superseded by handover.  
- Mid-shift Cash Drop remains when no pending (Q-SH3).  
- Implement slices SHA → SHB → SHC under the Approved Plan.
