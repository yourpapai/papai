<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0341: Analytics Stage B Readiness — Fail-Closed Delivery Gates and Evidence Report CLI

## Status

Accepted

## Context

The analytics staged rollout (see ADR-0326) gates external delivery lanes on a
Stage B entry checklist in `docs/operations/analytics-runbook.md`. A Stage A
whole-branch review surfaced three gating code items that had to be closed
before any external lane (Stage D/E) could be enabled:

1. `resolveSinkForSend` resolved a sink for delivery without checking that the
   sink's `egressMode` matched the delivery lane being processed — a
   pseudonymous event row could be sent through an aggregate-configured sink
   (or vice versa), violating the lane separation that the anonymity contract
   depends on.
2. `ClassifyDeliveryInput.grantKey` was optional. Classifying a missing or
   non-`sending` delivery row without the caller's grant key could leave the
   grant-send mutex wedged (`sending` rows never released), silently stalling
   delivery for that grant.
3. `buildDailyAggregateRelease` (the aggregate release path, ADR-0308) had no
   production caller — it existed as a library with no route invoking it, so
   the release gate could never actually execute a release.

Additionally, Stage B requires two consecutive complete weeks of daily
evidence (reconciliation, rejects, restart gaps, expiry, snapshot freshness,
delivery counts), and there was no tooling to collect that evidence in a
repeatable, operationally safe way.

## Decision Drivers

- **Fail-closed by default**: any ambiguity in lane matching, grant handling,
  or release execution must refuse the operation, never guess.
- **Lane separation is a privacy invariant** (ADR-0308, ADR-0326): aggregate
  and pseudonymous egress must never cross.
- **No new writes in the evidence path**: operators run the report from cron
  against a production database; it must be provably read-only.
- **Reuse the executable stage gates**: the window assessment must replay
  recorded days through the same `assessStageBWindow`/`assessStageCEntry`
  functions the rollout uses, so the report cannot drift from the gate
  semantics.
- **Minimal surface**: small, type-level fixes (required parameters) over
  runtime convention, so violations are compile errors.

## Considered Options

### Option 1: Lane-matching at send resolution, required grant key, route-wired release execution, read-only report CLI (chosen)

- Make `resolveSinkForSend` take a required `lane: 'aggregate' | 'pseudonymous'`
  parameter and refuse sinks whose `egressMode` differs; each worker call site
  passes its own lane.
- Make `ClassifyDeliveryInput.grantKey` required so the classification guard
  can always release a caller-held mutex when the row is missing.
- Extend the admin reconcile route's `release` block with optional
  `sinkVersionId` + `execute`; after a passing `assessReleaseRequest`, execute
  via `buildDailyAggregateRelease` gated on an enabled aggregate-lane sink
  version (`isEnabledAggregateSinkVersion`), with distinct 422 codes
  (`release_sink_required`, `release_sink_unavailable`,
  `release_day_incomplete`, `release_empty_day`). Assessment-only behavior is
  unchanged when `execute` is absent.
- Add `scripts/analytics-stage-b-report.ts` as a thin wrapper over a testable
  library (`src/analytics/jobs/stage-b-report.ts` collector/formatters,
  `stage-b-assess.ts` jsonl replay + gate verdicts). The script opens the
  database read-only, appends one JSONL record per day to an operator-managed
  log, and `--assess` replays the log through the executable stage gates.
- **Pros**: type-level enforcement makes misuse a compile error; the report is
  provably read-only (zero-write test with SQLite triggers); the replay uses
  the same gate functions as the rollout; idempotent re-execution via the
  release ledger.
- **Cons**: more call sites must thread the lane/grant key; the CLI is another
  operator surface to document.

### Option 2: Runtime-convention fixes only (no signature changes)

Keep parameters optional and document that callers must pass the lane and
grant key.

- **Pros**: smaller diff, no call-site churn.
- **Cons**: nothing enforces the invariant; the exact class of bug found in
  the Stage A review (a caller omitting the check) remains possible. Rejected:
  fail-closed must be structural, not conventional.

### Option 3: Evidence collection via ad-hoc SQL / manual runbook queries

Operators run documented queries and paste results into the evidence doc.

- **Pros**: no new code.
- **Cons**: unreproducible, error-prone, easy to drift from gate semantics,
  and cannot replay the window through `assessStageBWindow`/`assessStageCEntry`.
  Rejected: the Stage B exit decision must be machine-checkable.

## Decision

Adopt Option 1. Concretely:

1. `resolveSinkForSend(deps, sinkVersionId, lane)` requires the delivery lane
   and warns + returns `null` on an egress-mode mismatch
   (`src/analytics/delivery/worker-send.ts`; call sites `worker.ts:136` and
   `worker.ts:181`).
2. `ClassifyDeliveryInput.grantKey: string` is required; the
   missing-row/`not_sending` guard releases the caller-held mutex
   (`src/analytics/delivery/store-outcomes.ts`).
3. The reconcile route executes releases: `release: { utcDay, …, sinkVersionId?, execute? }`
   runs assessment first, then requires an enabled aggregate sink version and
   builds/enqueues the release idempotently, returning `releaseExecution`
   (`src/debug/settings/admin/analytics-routes.ts`,
   `src/analytics/delivery/sink-service.ts`).
4. The Stage B evidence CLI ships as a read-only report
   (`scripts/analytics-stage-b-report.ts` + `src/analytics/jobs/stage-b-*.ts`)
   with `--day/--db/--log` collection and `--assess` window replay.

## Rationale

- Required parameters turn the three review findings into compile-time
  guarantees; a future caller cannot silently reintroduce the wedge or the
  lane crossing.
- Executing releases through the existing reconcile route (which already
  runs the suppression assessment) keeps one decision point for "may this day
  be released" instead of a second, divergent path.
- A zero-write, cron-safe CLI with last-record-per-day JSONL semantics gives
  operators an idempotent daily ritual and gives the Stage B/C gate decision
  an auditable input that replays through the same gate code the rollout
  enforces.

## Consequences

### Positive

- Lane crossing at send time is impossible without a type error; crossed-lane
  behavior is pinned by an integration test (`worker.test.ts`).
- The `send_in_progress` mutex wedge from classifying missing rows is
  eliminated and regression-pinned (`store-outcomes.test.ts`).
- The aggregate release path has a real, gated production caller with an
  explicit deny matrix and idempotent re-execution.
- Stage B evidence collection is reproducible, read-only, and feeds directly
  into the executable stage-gate assessment.

### Negative

- All `resolveSinkForSend` / `classifyDelivery` call sites must thread the
  lane and grant key (one-time churn, enforced by typecheck).
- The reconcile route's release block grows in responsibility (assessment +
  execution); mitigated by keeping execution fail-closed and covered by route
  tests.
- The report CLI is an additional operational surface requiring runbook and
  evidence-doc maintenance.

### Risks

- The CLI's fixture/schema coupling (NOT NULL columns, active-generation
  singleton) could rot as the analytics schema evolves.
  Mitigation: the collector tests insert real rows and run against migrated
  test databases, so schema drift fails tests immediately.
- Operators could treat an ineligible-day report as an incident.
  Mitigation: exit code 0 for ineligible days (they are data, not failures)
  and a runbook note distinguishing suppressed-day reasons.

## Implementation Notes

- Commits: `6933360d6` (lane matching), `c3f39ddd1` (required grant key),
  `af2eae8ec` (release execution route), plus the report CLI commit; recorded
  in the runbook Stage B entry checklist and the evidence doc's readiness
  table.
- Plan: `docs/superpowers/plans/2026-07-28-analytics-stage-b.md`; design spec:
  `docs/superpowers/specs/2026-07-28-analytics-stage-b-design.md`.

## Related Decisions

- ADR-0308: Analytics governance and delivery lanes — defines the lane model
  and release machinery this ADR hardens.
- ADR-0326: Content-free analytics pipeline staged rollout — defines the
  stage gates this ADR's CLI replays.

## References

- `docs/operations/analytics-runbook.md` (Stage B entry checklist)
- `docs/research/analytics-metrics/09-stage-a-evidence.md` (Stage B window log,
  readiness evidence)
