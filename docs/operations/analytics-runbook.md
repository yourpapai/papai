<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics operations runbook

> Rollout, rollback, reconciliation, and review operations for papai analytics
> (`src/analytics/`). Incident response lives in
> [`analytics-incident-runbook.md`](./analytics-incident-runbook.md). Stage
> ordering is executable: `src/analytics/rollout/stage-gates.ts` +
> `tests/analytics/rollout-gates.test.ts`; the 17-control privacy contract is
> `tests/analytics/privacy-contract.test.ts`. Background, lane semantics, and
> env vars: `docs/architecture/behaviors.md`, `docs/architecture/environment.md`.

## Ownership

| Role | Owns |
|---|---|
| Engineering owner | jobs, reconciliation, storage/expiry, snapshot publication, sinks, rekey |
| Privacy/security owner | governance fields, key custody, Stage A evidence sign-off, incident exposure classification |
| Product/UX owner | dashboards, review ritual, friction sampling (metadata only) |

The privacy/security owner signs the Stage A evidence log
(`docs/research/analytics-metrics/09-stage-a-evidence.md`) before Stage B.

## Lanes and switches

- Stored policy: `analytics_policy` singleton (`local_mode`:
  `off`/`local_aggregate`/`local_pseudonymous`, `external_aggregate_enabled`,
  `external_pseudonymous_enabled`), managed via
  `GET/PATCH /settings/api/admin/analytics` (super admin, no restart needed).
- Deployment kill switch: `ANALYTICS_KILL_SWITCH=1` forces every lane off
  regardless of stored policy; a running process re-reads it at each lanes
  resolution, so no restart is required when the deployment can mutate the env
  in place. Stage A runs with the kill switch set.
- Governance readiness (required before `local_pseudonymous`): policy/notice
  versions, controller contact, purpose, lawful-basis mode, retained-event
  horizon, review date, operator acknowledgement, and both keyrings
  (`ANALYTICS_HMAC_KEYRING`, `ANALYTICS_GOVERNANCE_HMAC_KEYRING`). Missing items
  fail closed.

### Event population note: scheduler provider requests

Recurring-task scheduler executions emit provider-request facts with
`invocation_mode='scheduler'` and `actor_role='system'` (chat user = the task
owner). They appear in provider-request dashboards/exports like any other
provider request but are excluded from session-activity aggregation. When
analytics is off or the owner route is unresolvable, these executions run
unobserved by design (explicit sentinel) — recurring task creation itself is
never blocked by scope resolution.

## Operator commands (verified against the CLIs)

### Backfill (governed usage → closed aggregates)

```bash
bun run scripts/analytics-backfill.ts --dry-run                 # decide only, no writes
bun run scripts/analytics-backfill.ts                           # apply
bun run scripts/analytics-backfill.ts --resume                  # resume an interrupted run (identical decisions)
bun run scripts/analytics-backfill.ts --source llm --batch-size 500
bun run scripts/analytics-backfill.ts --reconcile               # apply + reconciliation; exit 1 on any delta
```

Refuses with `keyring_unavailable` without a valid `ANALYTICS_HMAC_KEYRING` and
with `approval_required` under `legitimate_interest` unless
`ANALYTICS_BACKFILL_APPROVED_AT_MS=<ms>` is set (used as the policy cutoff).
Apply prints one `run=… status=… applied=… skipped=…` line per source table; a
rerun of a finished window applies zero rows. `--reconcile` prints
`reconciliation status=reconciled unexplained_delta=0 …`; any delta exits 1.

Rollback of an applied run: select the run's rows via
`analytics_backfill_event_map` / `analytics_backfill_aggregate_contributions`,
settle and remove its deliveries, reverse only first-created deltas in one
reviewed transaction, then reconcile to zero before resuming (see the incident
runbook).

### Snapshot (Metabase)

```bash
bun run scripts/analytics-snapshot.ts --output /abs/path/snapshot.db
bun run scripts/analytics-snapshot.ts --output /abs/path/snapshot.db --verify
bun run scripts/analytics-snapshot.ts --output /abs/path/snapshot.db --verify --replace
bun run scripts/analytics-snapshot.ts --output /abs/path/snapshot.db --aggregate-only
```

Builds a fresh-empty allowlisted snapshot from the active storage generation,
byte/schema/freelist-scans the staging file, records a staged publication row,
and atomically renames into place (staging is cleaned on success and failure).
Without `--replace` an existing output path is refused. `--verify` re-verifies
the renamed file and exits 1 unless its recorded reconciliation status is
`reconciled`. `--aggregate-only` publishes only aggregate-lane models. Point
Metabase at the file in `ANALYTICS_SNAPSHOT_DIR` (`<snapshotId>.db`).

### Subject rights (authenticated settings routes, not CLIs)

```text
GET/PUT /settings/api/analytics/preferences     # per-actor collection/delivery preferences
POST    /settings/api/analytics/export          # authenticated DSAR export (all retained key versions)
POST    /settings/api/analytics/withdraw        # one-transaction withdrawal; pending delivery cancelled in-tx
POST    /settings/api/analytics/delete          # deletion workflow (local + snapshot + remote targets)
```

Deletion acknowledgement follows verified published-snapshot replacement:
Metabase queries quiesce, pooled connections close, the new immutable file is
remounted/reopened and queried for the new snapshot ID plus zero
deleted-subject contribution, and only then is the old file removed.

### Rekey (key rotation)

```bash
bun run scripts/analytics-rekey.ts plan --source-gen gen-1 --target-gen gen-2 --from-versions v1 --to-versions v2
bun run scripts/analytics-rekey.ts apply --run-id <id> --plan-hash <hash>
bun run scripts/analytics-rekey.ts verify --run-id <id>
bun run scripts/analytics-rekey.ts abort --run-id <id>   # pristine plan-phase runs only
```

Requires both keyrings to contain the target versions, a configured
retained-event horizon, and `ANALYTICS_SNAPSHOT_DIR` for BI coordination
(fail-closed without it). Only one nonterminal (`planned`/`running`/`paused`)
run may exist. After the first dual-write mutation, any failure leaves the run
`paused` — resume with `apply`, never `abort`. Pseudonymous egress stays paused
through cutover; old remote actor versions are deleted and reconciled before
eligible new-generation rows resend.

### Kill switch activation

1. Set `ANALYTICS_KILL_SWITCH=1` in the deployment environment and restart the
   bot — every lane resolves off at the next policy resolution.
2. For a no-restart partial stop, `PATCH /settings/api/admin/analytics`
   (`local_mode: 'off'`, `external_aggregate_enabled: false`,
   `external_pseudonymous_enabled: false`).

### Reconciliation

```bash
bun run scripts/analytics-backfill.ts --reconcile   # CLI path (requires keyring + approval env)
POST /settings/api/admin/analytics/reconcile        # { "apply": true|false } — on-demand report
```

A report is release-grade only when: `status=reconciled`,
`unexplained_delta=0` for every **closed** process epoch, zero event/aggregate
epoch-association violations, delivery state conservation holds (including
visible non-retried `sending`/`ambiguous` rows), and no UTC bucket is
`unreconciled_restart_gap`. A stale-open (crashed) epoch marks every UTC bucket
it touches a restart gap — that window receives no balancing term and is
blocked from publication, external release, and rollout evidence; it never
becomes zero-delta evidence by estimating crash loss.

## Rollout stages A–E

### Stage A — code present, collection off

- **Entry:** Tasks 1–18 merged; all release commands green.
- **Operate:** keep `ANALYTICS_KILL_SWITCH=1`; apply migrations; run synthetic
  fixtures, `bun test tests/analytics/privacy-contract.test.ts`, backfill
  `--dry-run`, a synthetic snapshot build/verify, deletion and rekey drills,
  and the captured-egress scan. No actor-linked writes, no network sends.
- **Exit:** privacy controls 1–17 green; a synthetic complete process epoch
  reconciles to zero; snapshot bytes verify; drills complete; privacy/security
  owner signs the evidence log.
- **Rollback:** keep the kill switch set; revert runtime/UI commits if needed;
  leave additive analytics tables dormant (no down migration).

### Stage B — aggregate-local

- **Entry:** valid Stage A evidence (executable: `assessStageBEntry`).
- **Operate:** remove the deployment kill-switch override, keep
  `local_mode=local_aggregate`. Run two complete UTC weeks. Daily: review
  normalization rejects, exact overflow counters, restart-gap status,
  reconciliation, storage/expiry, snapshot writer impact, dashboard freshness
  and query p95. This stage cannot report actors, sessions, intent, cohorts,
  retention, or feature penetration.
- **Exit:** two **consecutive** complete UTC weeks whose contributing process
  epochs all closed cleanly with zero unexplained delta, zero
  C3/raw-ID/guest-continuity findings, bounded overflow within the accepted
  threshold, verified deadline-aware 90-day expiry, and snapshot/query SLO
  compliance. Any `unreconciled_restart_gap` day is suppressed and restarts the
  evidence window — two **new** consecutive weeks are required.
- **Rollback:** set the kill switch immediately; preserve daily rows for the
  normal expiry job unless incident response requires delete/rebuild; any
  privacy finding returns to Stage A.

### Stage C — governed local pseudonymous pilot

- **Entry:** governance readiness complete **and** two complete consecutive
  Stage B UTC weeks (executable: `assessStageCEntry`).
- **Operate:** enable `local_pseudonymous` for explicit test actors or one
  controlled installation only; in consent mode only post-allow activity is
  eligible. Each pilot actor must then grant collection eligibility from their
  own settings page — `PUT /settings/api/analytics/preferences` with
  `localLongitudinal` (or `externalPseudonymous`) set to `allow`. That write
  derives the actor's `collection-eligibility:v1` ref and commits it in the same
  transaction as the consent record, so the two cannot diverge; until it lands,
  every pseudonymous decision for that actor denies with
  `governance_incomplete` and no event is written. Setting both lanes back to
  `deny` revokes the ref in the same way. There is no operator-side grant: the
  ref exists only as the shipped consequence of the actor's own consent. Run
  at least two weekly review cycles and one complete authenticated
  export/withdraw/delete exercise; hand-calculate sessions,
  activation, outcomes, intent coverage, and censoring against the
  materializations; drill HMAC key backup/restore and a planned rekey.
- **Exit:** hand-calculations match; withdrawal passes collection and delivery
  races; 90-day expiry and all-key-version export/delete/rekey pass; deletion
  acknowledgement follows verified snapshot replacement; reply-path latency and
  queue growth stay within accepted bounds.
- **Rollback:** switch `local_mode` back to `local_aggregate` (stops new actor
  events immediately), cancel pending actor delivery, run the deletion workflow
  for pilot actors if notice/policy requires, rebuild affected
  materializations, reconcile before declaring rollback complete.

### Stage D — optional external aggregate

- **Entry:** completed aggregate anonymization assessment (executable:
  `assessStageDEntry`) and a reviewed aggregate sink
  (`POST /settings/api/admin/analytics/sinks`, then
  `…/sinks/:id/verify`).
- **Operate:** release only complete UTC-day cells from the frozen all/one-way
  lattice after deterministic primary and complementary suppression (actor
  cells ≥10 eligible actors; guest cells ≥10 turns AND ≥10 contexts; null
  contributor counts suppressed; restart-gap cells never publishable). Repeat
  exhaustive differencing, captured-request proof, and daily reconciliation for
  two weeks. Release requests are fail-closed
  (`POST /settings/api/admin/analytics/reconcile` with a `release` block):
  custom ranges, rolling windows, multi-dimension, per-app-version, and
  drill-through requests are denied.
- **Rollback:** disable the sink (`…/sinks/:id/disable`) or set the kill
  switch; cancel pending aggregate releases; retain delivered receipt hashes
  for 30 days; reconcile local release IDs against destination totals.

### Stage E — optional external pseudonymous (closed)

Stage E stays closed. It may open only after a separately reviewed sink passes
the **strict AND** of caller-controlled destination idempotency, deterministic
reconciliation, and complete per-actor deletion for every key version — no one
capability substitutes for another — plus processor/residency/security
approval, a pinned integration, and a successful deletion canary. Operator
enablement **and** per-actor `external_pseudonymous=allow` are both mandatory
(executable: `assessStageEEntry`). OpenPanel does not pass this gate on the
capabilities recorded in
`docs/research/analytics-metrics/05-provider-scorecard-and-poc.md`
(caller-controlled idempotency and per-actor deletion fail;
`OPENPANEL_ASSESSED_CAPABILITIES` in `src/analytics/delivery/sink.ts` keeps the
`external_pseudonymous` production registry empty). If it ever opens: one sink,
a daily cap, the kill switch armed, daily reconciliation for the first two
weeks then weekly.

## Stage B entry checklist

Deferred external-lane items triaged from the Stage A whole-branch review.
Every item is **gating**: none of the external lanes (Stage D/E) may be
enabled until all boxes are checked.

- [x] `resolveSinkForSend` matches the event/aggregate `egressMode` to the
  delivery lane before any external lane is enabled (fixed: lane parameter
  required at send resolution, commit 6933360d6).
- [x] The release path has a production caller: the reconcile route's
  `release` block accepts `sinkVersionId` + `execute` and runs
  `buildDailyAggregateRelease` after a passing assessment (commit
  af2eae8ec).
- [x] `ClassifyDeliveryInput.grantKey` is a required field (commit
  c3f39ddd1).
- [ ] `rotateSinkVersion` runs the capability gate **before** creating the
  successor version — today the `pending_verification` successor is created
  first and a gate denial leaves it orphaned
  (`src/analytics/delivery/sink-service.ts`).
- [ ] `remoteDeleteIn` dedupes per-actor remote deletion calls across an
  actor's multiple settled deliveries
  (`src/analytics/delivery/remote.ts`) — currently one call per delivery
  row, relying on sink-side idempotency.
- [ ] Response-cap coverage: a test exercises `EGRESS_MAX_RESPONSE_BYTES`
  truncation and pins the receipt-hash semantics over a truncated body
  (`src/analytics/delivery/pinned-transport.ts`).
- [ ] Admin sink-gate attestation checkboxes default to **unchecked**, so
  sink enablement is an explicit operator act
  (`client/settings/sections/admin/AdminAnalyticsSection.svelte`).

## Recurring schedule

### Daily (automated jobs + 10-minute review)

- Hourly: reconciliation job (`src/analytics/jobs/reconcile.ts`,
  fence-admitted apply phase); snapshot publication; delivery drain.
- Bounded lifecycle jobs on the shared scheduler
  (`src/analytics/jobs/register.ts`): derive, intent derivation, retention
  purge, censor maturity, backfill/reconcile as configured — all
  cutover-fence admitted and expiry-guarded.
- Review: reconciliation status, rejects, restart gaps, delivery
  `sending`/`ambiguous` counts, snapshot freshness. During Stage B, collect
  the day record with
  `DB_PATH=... bun run scripts/analytics-stage-b-report.ts --log /var/lib/papai/stage-b.jsonl`
  (read-only; cron-safe; see the Stage B design spec) and paste the printed
  window-log row into the evidence doc.
  If a day reports `reconciliation=gap` with `reason=ok`, the restart gap
  belongs to an earlier day (its own row is suppressed); the current day is
  eligible and no incident response is needed.

### Weekly (45 minutes; product/UX + engineering, privacy/security when gated)

Data health (freshness, reconciliation, rejects, eligibility coverage,
censored share, suppression), activation/outcomes, friction/performance,
scenarios/adoption, decision log — per
`docs/research/analytics-metrics/07-validation-and-review-ritual.md` §6.
Friction sampling is metadata-only via
`bun run scripts/analytics-friction-sample.ts --output /abs/sample.json --token-map /abs/map.json [--per-stratum 3] [--seed weekly]`;
destroy the token map at meeting end (`--destroy-token-map /abs/map.json`).
Stage B/C evidence windows: reconciliation must be zero-delta on every
contributing closed epoch for the week to count.

### Monthly (60 minutes)

Model/dashboard inventory review, retirement of ownerless cards,
retention/expiry job and storage-trend check, one withdrawal/delete canary plus
one dashboard C3 export canary, SMALL_MODEL status review (default off), sink
support/version review with affected gates re-run, and a written statement on
whether SQLite snapshot freshness and query p95 still meet the defined SLO
before any warehouse is considered.

### Quarterly

Privacy/security review (purposes, modes, keys, RBAC, processor/residency,
aggregate anonymization assessment), isolated-environment key-backup restore +
planned rekey rehearsal, full DSAR/export/delete drill across local storage and
every approved sink, two-reviewer audit of a stratified sample of adapters and
dashboard formulas, intent taxonomy review only via a new-version proposal.

## Dashboard freshness and query SLO

- Every card shows its snapshot timestamp; an empty or late snapshot renders a
  freshness warning, never stale certainty.
- Percentages hide below denominator 30; external actor segments suppress
  below 10; dashboard filters cannot recover a suppressed adjacent cell.
- Snapshot freshness and query p95 are reviewed at every Stage B week and at
  the monthly ritual; the monthly record documents SLO compliance explicitly.
- Metabase product users query curated saved models only — never raw
  `props_json`; OpenPanel or any event product is never authoritative for
  papai sessions, percentiles, deletion state, or definitions it cannot express
  exactly.

## Storage thresholds and retention

Deadline-aware expiry is enforced at every read/derive/export/snapshot/
lease/send boundary (`expiresAtMs > now`), with a startup purge barrier and
earliest-deadline wake. Maxima (`src/analytics/retention/expiry-guard.ts`):

| Data class | Maximum retention |
|---|---|
| Canonical events | 90 days (v1 subject-rights horizon) |
| Pending delivery | 14 days |
| Delivery receipts | 30 days |
| Assessed rollups | 400 days |
| Superseded governance audit | 400 days |
| External pseudonymous sink data | 90 days |
| Rephrase feature sets | 30 minutes, in-memory only |

Review the storage trend weekly during Stage B and monthly thereafter; growth
beyond the expiry envelope means the purge job or expiry guard is broken —
treat as an incident. SQLite snapshot files are immutable and replaced
atomically; old files are removed only after the consumer remount verification
passes.
