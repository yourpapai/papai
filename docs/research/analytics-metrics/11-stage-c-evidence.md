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
| 2026-08-14 | true | — | none | 0 | 99 (invalid_value=99) | 0 | ok | — |
| 2026-08-15 | false | delta | none | 0 | 0 | 0 | ok | — |
| 2026-08-16 | false | delta | none | 0 | 0 | 0 | ok | — |
| 2026-08-17 | false | delta | 2026-08-18T00:00 | 0 | 23 (invalid_value=23) | 0 | ok | — |
| 2026-08-18 | false | delta | 2026-08-19T00:00 | 0 | 4 (invalid_value=4) | 0 | ok | — |
| 2026-08-19 | false | delta | 2026-08-20T00:00 | 0 | 0 | 0 | ok | — |

Days 2026-08-17–19 stayed `delta` because the pre-fix writer was still in
production until v6.14.0 (deployed 2026-08-20, contains the writer fix +
migration `078`); those closes are the same 2026-08-17 incident, not new ones.
Clean-day evidence restarts 2026-08-20.

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
- 2026-08-17: **window interruption.** Days 2026-08-15/16 reported `reconciliation=delta` (live-epoch delta): the live aggregate lane wrote epoch contribution rows but never the matching `opportunity`/`aggregate_only` epoch source counters, so every epoch closed with `delta = |0 − contributions|`. Invisible during Stage B because the long-lived epoch stayed open all window (open epochs aren't delta-checked); surfaced when the v6.13.x deploys closed epochs. Fixed in the aggregate writer (counters now bump in contribution units, same transaction, live lane only) + migration `078` repairs the two poisoned closed epochs from their contribution cell keys. Consecutive-clean-day evidence restarts from the deploy containing this fix; the two delta days are kept as honest negatives, not edited.
- 2026-08-20: **pseudonymous lane collected nothing since entry.** Post-v6.14.0 verification showed all closed epochs `publishable` (08-17 incident cleared), but `analytics_events` empty with 2222+ aggregate opportunities. Root cause: no production caller provisions the `allow` row in `analytics_collection_eligibility` — `setEligibilityState` is test-only; `PUT /settings/api/analytics/preferences` writes the preference row but never collection eligibility, so `decideEligibility` denies every non-guest actor with `governance_incomplete` and all events degrade to aggregate-only. Fix pending: preference PUT `localLongitudinal=allow` must also provision the collection ref; `deny` must revoke. Hand-calculation drills and pseudonymous evidence deferred until the fix deploys and data accrues.
  - **Fix shipped** (change `provision-collection-eligibility`): the
    preferences PUT now provisions/revokes
    `analytics_collection_eligibility` alongside the preference write. After
    deploying, the pilot actor must open `/settings` → Analytics and re-save
    `localLongitudinal: allow` once; canonical events then accrue from that
    moment.
