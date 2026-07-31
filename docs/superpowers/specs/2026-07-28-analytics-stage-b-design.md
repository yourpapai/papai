<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage B — readiness fixes and rollout operations design

**Date:** 2026-07-28
**Status:** Approved (design); implementation not started
**Binding specifications:** [`docs/research/analytics-metrics/02-metric-catalog.md`](../../research/analytics-metrics/02-metric-catalog.md),
[`03-privacy-consent-threat-model.md`](../../research/analytics-metrics/03-privacy-consent-threat-model.md),
[`docs/operations/analytics-runbook.md`](../../operations/analytics-runbook.md)
**Evidence doc:** [`docs/research/analytics-metrics/09-stage-a-evidence.md`](../../research/analytics-metrics/09-stage-a-evidence.md) (Stage B window log section)
**Executable gates:** `src/analytics/rollout/stage-gates.ts` (`assessStageBWindow`, `assessStageCEntry`)

This spec covers Stage B readiness: the three gating code fixes from the
runbook's Stage B entry checklist, the read-only daily evidence report CLI,
and the production rollout operations for the two-consecutive-week
`local_aggregate` evidence window. It does not re-specify the analytics
system; metric definitions, the privacy contract, and rollout stage semantics
live in the binding documents above.

## Decisions

| Decision | Outcome |
|---|---|
| Scope | Three gating code fixes **and** rollout operations (evidence CLI + window ritual) |
| Landing | All work on the analytics branch (`claude/analytics-metrics-research-plan-0q1fqk`), pre-merge; one commit per fix plus one for CLI/docs |
| Release-path wiring | Approach A — manual release-execute route (no scheduler job, no in-worker build) |
| Evidence collection | Read-only report CLI on the production host; cron for collection, human for review/recording/sign-off |
| Stage B window | Owner's production instance, real traffic, two consecutive complete UTC weeks of `local_mode=local_aggregate` |
| Escalation | Reason-dependent (see §6): restart gaps are operational, tooling bugs are small fixes, only reconciliation deltas / privacy findings become incident + design work |

## 1. Gating code fixes

All three fixes are TDD commits on the analytics branch, pre-merge. Each
checks off one box in the runbook's **Stage B entry checklist**; gate evidence
is appended to `09-stage-a-evidence.md`.

### 1.1 `resolveSinkForSend` egressMode matching

**Location:** `src/analytics/delivery/worker-send.ts` (`resolveSinkForSend`),
callers in `src/analytics/delivery/worker.ts` (both lane paths).

**Today:** loads sink config by `sinkVersionId`, returns it when
`state === 'enabled'`. The config carries `egressMode` (event vs aggregate
lane) but it is never compared to the delivery row's lane, so a crossed
`sinkVersionId` would route a payload to the wrong-lane endpoint.

**Change:** `resolveSinkForSend` gains a required lane parameter; each worker
lane path passes its row's egress mode. Mismatch → return `null` plus a pino
`warn` (metadata: sink version id and both lane tags only — never endpoint,
secret, or payload). A `null` resolution means the row is never sent and
surfaces in delivery reconciliation, failing closed.

**Tests:** crossed-lane fixtures in both directions (event row → aggregate
sink, aggregate row → event sink): enabled-but-wrong-lane never sends; the
unsent row is visible to the reconciliation report.

### 1.2 Release-path production caller (release execution route)

**Location:** `src/debug/settings/admin/analytics-routes.ts` (reconcile route
`release` block), `src/analytics/delivery/aggregate-release.ts`
(`buildDailyAggregateRelease`, currently caller-less).

**Today:** `assessReleaseRequest` runs inside
`POST /settings/api/admin/analytics/reconcile` when the body carries a
`release` block, but only as an assessment sidecar — the route returns
`releaseAssessment: { ok: true }` and nothing is built or enqueued.

**Change:** the `release` block of `ReconcileBodySchema` gains two optional
fields: `sinkVersionId: string` and `execute: boolean` (default `false` =
today's assessment-only behavior, fully backwards compatible). On
`execute: true`:

1. `assessReleaseRequest` runs first, unchanged and fail-closed: custom
   ranges, rolling windows, multi-dimension, per-app-version, drill-through,
   incomplete UTC days, and restart-gap days are denied (`422
   release_denied`).
2. On pass, the route resolves the sink: `sinkVersionId` must exist, be
   `enabled`, and be aggregate-lane. Missing / disabled / wrong-lane →
   `422` with a typed code.
3. `buildDailyAggregateRelease({ utcDay, sinkVersionId, nowMs })` builds the
   strict V1 release envelope from the frozen all/one-way lattice with
   primary thresholds and complementary suppression, computes the
   deterministic content-hash `releaseId`, and inserts the aggregate-release
   ledger rows in a **single transaction** — never a partial enqueue.
   Re-executing the same day is idempotent: same `releaseId`, zero new rows.
4. The hourly delivery worker drains the ledger under its existing gates
   (kill switch, daily cap, cutover-fence admission).

Response carries the assessment result plus `releaseId` and row counts.

**Stage B posture:** no sink is enabled during Stage B, so this path is
exercised only in drills and tests. It ships now so Stage D enablement is a
pure config operation (create → verify → enable sink) with no new deploy.

**Tests:** full deny matrix (rolling window, multi-dimension, app-version,
drill-through, custom range) stays denied with `execute: true`; execute happy
path enqueues expected rows; re-execute idempotency (same `releaseId`, zero
new rows); sink gating trio (no sink / disabled / wrong lane → 422);
auth/CSRF gates unchanged.

### 1.3 `ClassifyDeliveryInput.grantKey` required

**Location:** `src/analytics/delivery/store-outcomes.ts`
(`ClassifyDeliveryInput.grantKey`), callers in the delivery worker classify
path.

**Today:** `grantKey?: string` is optional. The classify path consults
`mutex.isHeld(input.grantKey)`; a caller omitting it while the per-grant send
mutex is held on the row's stored grant can wedge the grant at
`send_in_progress` (acquire/release key pairing inexact).

**Change:** `grantKey: string` becomes required at the type level. The worker
classify path passes the row's stored grant key, so mutex acquire and release
always pair on the same key by construction. Omission is a compile error.

**Tests:** regression — classify with the mutex held on the row's grant
releases cleanly and no grant remains at `send_in_progress`; the
withdrawal-race suites stay green.

## 2. Report CLI — `scripts/analytics-stage-b-report.ts`

Read-only operator CLI producing the daily Stage B evidence record and the
window-end gate verdict.

### 2.1 Interface

```text
bun run scripts/analytics-stage-b-report.ts [--day YYYY-MM-DD] [--db PATH]
                                            [--log PATH]
bun run scripts/analytics-stage-b-report.ts --assess --log PATH [--db PATH]
```

- `--day`: UTC day to report; default is yesterday UTC. The day is always
  computed in UTC regardless of host timezone.
- `--db`: SQLite path; falls back to `DB_PATH` env. No keyring or other
  secrets are required by any code path.
- `--log`: append the day's JSON record to a jsonl file (machine history that
  survives skipped manual days).
- `--assess`: instead of collecting, replay all days recorded in the jsonl
  log through `assessStageBWindow`, read governance readiness from the policy
  store, run `assessStageCEntry`, and print both verdicts. When multiple
  records exist for one day, the last record wins.

### 2.2 Read-only guarantee

The CLI opens its own connection with `new Database(path, { readonly: true })`
— never the application singleton. It performs zero writes: no migrations, no
`apply` paths, no temp tables. Reconciliation uses the existing pure read path
`runReconciliation({ nowMs, apply: false })` (no keyring, no fence admission).

### 2.3 Collected fields (per UTC day)

| Field | Source |
|---|---|
| `reconciliation` status + `unexplained_delta` | `runReconciliation({ apply: false })` over the day's closed process epochs |
| `restart_gap` | any stale-open process epoch touching the day's UTC bucket → day is `unreconciled_restart_gap` |
| `rejects` | count by reason from the bounded rejection store for the day |
| `overflow` | per-epoch exact disposition/overflow counters |
| `expiry` | retention purge last-run timestamp, earliest expiry deadline, table-size trend sample |
| `snapshot` | latest publication id + created-at, verify status, freshness vs SLO |
| `delivery` | `sending` / `ambiguous` row counts (expected zero open lanes in Stage B) |

Day classification follows `isDayRolloutEligible`
(`completeUtcDay && reconciliationStatus === 'complete_epoch'`); the CLI
prints `eligible=true|false` plus a machine `reason`
(`restart_gap` / `delta` / `incomplete_day` / `unknown`).

### 2.4 Output and exit codes

Stdout: a one-line human summary, then a `window-log-row:` markdown row whose
columns match the daily-log table in the evidence doc 1:1 (paste is
mechanical). With `--log`, the JSON record is also appended.

Any field the CLI cannot determine is printed as `unknown` and the day is
ineligible — evidence is never estimated or invented.

| Exit code | Meaning |
|---|---|
| 0 | Report produced (including `eligible=false` days — ineligibility is data) |
| 1 | Operational failure: `db_unreadable`, migration mismatch, lock after one 5s retry. Cron mails the operator; the day records as `unknown` |

### 2.5 Testing

Fixture DBs (reusing `tests/analytics` fixtures): eligible day, restart-gap
day, delta day, unknown day (missing table), `--assess` with passing and
failing two-week windows, jsonl append + last-record-wins per day, and a
zero-write proof against a write-counted fixture DB.

## 3. Operations guide — daily evidence collection

### 3.1 One-time prerequisites (production host)

1. Branch merged and deployed; migrations 072–075 applied; bot running with
   `ANALYTICS_KILL_SWITCH=1`.
2. Verify read-only concurrency: `PRAGMA journal_mode;` on the DB returns
   `wal` (a read-only reader never blocks the bot's writer under WAL; if it
   returns `delete`, the CLI still works but keep runs short).
3. Locate the DB: the same `DB_PATH` the bot uses (e.g.
   `/var/lib/papai/papai.db`).
4. Flip policy to start the window:
   `PATCH /settings/api/admin/analytics` with `local_mode: 'local_aggregate'`,
   then remove the `ANALYTICS_KILL_SWITCH=1` override from the deployment
   environment. Window day 1 is the next UTC midnight boundary.

### 3.2 Daily manual run (the 10-minute review)

```bash
# 1. Reach the production host (or anywhere the DB file is readable)
ssh papai-prod

# 2. Run the report (default day = yesterday UTC)
DB_PATH=/var/lib/papai/papai.db bun run scripts/analytics-stage-b-report.ts
#    or an explicit day:  ... --day 2026-08-05

# 3. Read the output, e.g.:
#    day=2026-08-05 eligible=true reconciliation=reconciled unexplained_delta=0
#      restart_gap=false rejects=3 (unknown_enum=2, props_out_of_domain=1) overflow_counters=0
#      expiry_ok=true purge_last_run=2026-08-06T00:05:11Z earliest_deadline=2026-11-03
#      snapshot=id=9c1f... created=2026-08-06T00:01:02Z verified=true fresh=true
#      delivery sending=0 ambiguous=0
#    window-log-row:
#    | 2026-08-05 | true | — | 2026-08-06T00:01Z | 0 | 3 (unknown_enum=2, props_out_of_domain=1) | 0 | ok | — |

# 4. Paste + commit (section 4.1)

# 5. Apply the decision tree (section 4.2)
```

### 3.3 Cron (collection only)

The CLI is cron-safe: no secrets, read-only open, UTC computed internally.

```cron
CRON_TZ=UTC
15 0 * * * DB_PATH=/var/lib/papai/papai.db /usr/local/bin/bun /opt/papai/scripts/analytics-stage-b-report.ts --log /var/lib/papai/stage-b.jsonl >> /var/log/papai/stage-b.log 2>&1
```

Rules: absolute paths everywhere (cron's `PATH` is minimal); `CRON_TZ=UTC`
pinned as defense-in-depth; `--log` keeps machine history even when the
operator skips a day; non-zero exit mails the operator and the day records as
`unknown` (ineligible, fail-closed).

Cron deliberately does **not** paste evidence, judge eligibility, or sign the
window. Automation collects; the human reviews and records. Fully automated
evidence was considered and rejected: Stage B evidence requires human
sign-off, and an ineligible day requires an operator decision, not a script.

### 3.4 Window end

```bash
DB_PATH=/var/lib/papai/papai.db \
  bun run scripts/analytics-stage-b-report.ts --assess --log /var/lib/papai/stage-b.jsonl
# consecutive_complete_weeks=2 stage_b_exit=allowed stage_c_entry=allowed|refused [...]
```

### 3.5 Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `db_unreadable` | wrong `DB_PATH` / permissions | fix path; day = `unknown` (ineligible) |
| `restart_gap=true` | bot crashed or restarted uncleanly that day | day suppressed, window restarts; check deploy logs |
| `reconciliation=delta` | conservation broke | incident runbook; consider rollback to kill switch |
| `snapshot fresh=false` | snapshot job stalled | check scheduler; SLO breach noted in weekly review |

## 4. Manual steps (cron never does these)

### 4.1 Paste the evidence row

On the local repo checkout (master, post-merge):

1. Open `docs/research/analytics-metrics/09-stage-a-evidence.md`, section
   **Stage B window log (post-merge, operational)**.
2. **Day 1 only**, fill the header fields: `Deploy date / version` (merge
   commit sha), `Window start (UTC)`.
3. Paste the CLI's markdown row into the **daily log table** (added to the
   doc by this design; columns match CLI output 1:1):
   `| Day (UTC) | Eligible | Reason | Freshness | Recon delta | Rejects | Overflow | Expiry | Notes |`.
4. At each week's end (day 7, 14, …) fill the existing **weekly summary row**
   by aggregating that week's daily rows: worst freshness, delta sum (must be
   0), reject total, overflow total, worst expiry status.
5. Commit per day: `docs(research): stage B day 2026-08-05 evidence`, push.
   Commit history is the audit trail — never amend evidence commits;
   corrections land as new commits referenced in `Notes`.

### 4.2 Eligibility decision tree

The CLI classifies mechanically (`isDayRolloutEligible`); the operator's
judgment is the operational response:

```text
eligible=true
└─ paste row, done. rejects > 0 is fine (fail-closed drops, not conservation
   breaks) — record counts/reasons.

eligible=false, reason=restart_gap
├─ day suppressed → the consecutive-week counter RESTARTS
├─ check bot logs/deploy events for the unclean shutdown; note cause in Notes
└─ no rollback by itself; two NEW consecutive weeks are required from tomorrow

eligible=false, reason=delta (reconciliation broke)
├─ TREAT AS INCIDENT → docs/operations/analytics-incident-runbook.md
├─ decide within the daily review: rollback (ANALYTICS_KILL_SWITCH=1 + PATCH
│  local_mode=off) vs continue investigating with lanes on
├─ any privacy-relevant finding (C3 / raw ID / guest continuity) → return to
│  Stage A posture and notify the privacy/security owner
└─ window restarts only after status=reconciled returns

any field = unknown
├─ day ineligible, no exceptions — evidence is never estimated or backfilled
├─ investigate: tooling bug (fix CLI; the day still does not count) vs real gap
└─ a missed CLI run day = unknown day (the cron --log backup exists for this)
```

Hard rules: never estimate crash loss into a gap day; never retroactively
mark a day eligible; never skip daily commits and reconstruct the table later.

### 4.3 Sign the window

Precondition: ≥14 consecutive eligible days.

1. Run `--assess` (§3.4); it replays recorded days plus governance readiness
   from the policy store.
2. Verify exit criteria against the daily rows (runbook §Stage B exit): two
   consecutive complete UTC weeks, every contributing epoch closed cleanly
   with zero unexplained delta, zero C3/raw-ID/guest-continuity findings,
   bounded overflow, verified deadline-aware expiry, snapshot/query SLO
   compliance recorded in the weekly reviews.
3. In the evidence doc: fill `Window end (UTC)`, paste the assess output
   verbatim below the weekly table, complete both weekly summary rows.
4. Sign `**Stage B exit review:** <name(s)> date: <date>` — engineering owner
   + product/UX owner (weekly-ritual owners); the privacy/security owner
   signs additionally if any privacy-relevant finding occurred during the
   window.
5. Commit: `docs(research): stage B exit evidence — window <start>..<end>`.
6. `stage_c_entry=allowed` + governance readiness complete → Stage C planning
   may begin. A failed window has nothing to sign — keep collecting daily
   rows; the counter is already running.

## 5. Docs updates

- `09-stage-a-evidence.md`: add the **daily log table** and the assess-verdict
  block to the Stage B window log section (structure per §4.1).
- `docs/operations/analytics-runbook.md`: check off the three Stage B entry
  checklist items with commit references; add the report CLI to the daily
  review bullet.

## 6. Escalation mapping

| CLI result | Response |
|---|---|
| `eligible=false, reason=restart_gap` | Operational, expected — note cause, window counter restarts, no design work. Escalate only on recurrence (reliability investigation) |
| `unknown` from CLI/tooling bug | Tooling fix — patch the report CLI; the day still does not count |
| `eligible=false, reason=delta` or privacy finding (C3/raw-ID/guest continuity) | Incident runbook first (assess; likely kill switch + `local_mode=off`), then root-cause → brainstorm → design → plan → TDD fix (the Stage A agent workflow). A privacy finding returns the rollout to Stage A posture; the privacy/security owner re-signs evidence before Stage B resumes |

Design/brainstorming sessions are reserved for genuine defects in the
analytics system itself, not operational noise.

## 7. Gates for this work

- TDD per repo rules (write hooks); one commit per fix (1.1, 1.2, 1.3) and one
  for CLI + docs.
- Named suites green: `tests/analytics/delivery/*`,
  `tests/debug/settings/admin/analytics-routes.test.ts`, new
  `tests/scripts/analytics-stage-b-report*` suites.
- Binding sequence: `bun test tests/analytics tests/settings tests/debug`,
  `bun run typecheck`, `bun run lint`, `bun security`, `bun run knip`,
  privacy-contract + rollout-gates suites.
- Evidence appended to `09-stage-a-evidence.md`; runbook checkboxes checked
  (§5).
