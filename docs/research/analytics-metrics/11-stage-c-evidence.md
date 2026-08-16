<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage C evidence log

**Opened:** 2026-08-16
**Runbook:** [`../../operations/analytics-runbook.md`](../../operations/analytics-runbook.md) (Stage C — governed local pseudonymous pilot)
**Prior stage:** [`09-stage-a-evidence.md`](./09-stage-a-evidence.md) (Stage B certified 2026-08-15: `consecutive_complete_weeks=2 stage_b_exit=allowed`)

This log is the durable evidence of record for the Stage C exit gate: the
pseudonymous-lane entry result, the daily window log, the required drills
(export/withdraw/delete, key backup/restore, planned rekey), the hand-calculation
checks against materializations, and the exit review.

## Entry gate

- Deploy date / version: 2026-08-15 / v6.13.0 (contains #209 fix `29eb112b1`)
- Governance readiness: `stage_c_entry=allowed` (assess 2026-08-15; policy metadata + operator acknowledgement at `analytics_policy` config_version 3)
- Lawful basis: `legitimate_interest` (eligibility matrix without per-subject consent gates)
- Collection mode flipped to `local_pseudonymous`: 2026-08-15
- Scope: one controlled installation (personal bot); guests produce no session rows by design

## Operate-phase tracking (runbook requires ≥2 weekly review cycles)

- [ ] Two weekly review cycles completed (dates below)
- [ ] One complete authenticated export/withdraw/delete exercise
- [ ] Hand-calculations: sessions, activation, outcomes, intent coverage, censoring — matched against materializations
- [ ] HMAC key backup/restore drill
- [ ] Planned rekey drill
- [ ] Deletion acknowledgement follows verified snapshot replacement (**blocked**: ordinary staged→published promotion unwired — tracked separately)
- [ ] Reply-path latency and queue growth within accepted bounds
- [ ] 90-day expiry verified on canonical rows (`analytics_events.expires_at_ms`)

### Weekly review cycles

| Cycle | Dates | Rejects delta from baseline | Delta | Expiry | Notes |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |

### Daily log (report CLI rows)

| Day (UTC) | Eligible | Reason | Freshness | Recon delta | Rejects | Overflow | Expiry | Notes |
|---|---|---|---|---|---|---|---|---|

### Drills

| Drill | Date | Result | Evidence |
|---|---|---|---|
| Export (authenticated, pilot subject) | | | |
| Withdraw (collection-ref race) | | | |
| Delete (cascade + censor intervals) | | | |
| Key backup/restore | | | |
| Planned rekey | | | |
| Deletion ack after verified snapshot replacement | | | |

### Hand-calculation checks

| Metric | Hand-calculated | Materialization | Match? | Notes |
|---|---|---|---|---|
| Sessions | | | | |
| Activation | | | | |
| Outcomes | | | | |
| Intent coverage | | | | |
| Censoring | | | | |

**Stage C exit review:** ____________________  date: ________

## Notes / incidents

- 2026-08-15: `invalid_value` rejects expected to drop to ~0 with v6.13.0 (#209 fix live); verify against the first post-deploy daily rows.
