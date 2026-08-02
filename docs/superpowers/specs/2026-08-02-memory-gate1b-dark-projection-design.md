<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1b — dark projection, checkpoint, idempotent apply, repair

**Status:** design

Second of four specs implementing Gate 1 of
[`2026-07-26-memory-production-roadmap.md`](../plans/2026-07-26-memory-production-roadmap.md).

Bound by the observables and boundaries frozen in
[`2026-07-29-memory-gate1-predicate-registration-design.md`](2026-07-29-memory-gate1-predicate-registration-design.md).

Builds directly on
[`2026-07-30-memory-gate1a-canonical-capture-spine-design.md`](2026-07-30-memory-gate1a-canonical-capture-spine-design.md),
which is implemented.

## Problem

1a delivers a canonical event log, a projection outbox, a durable attempt log, and the identity
model — but nothing consumes the outbox. Rows accrue and are never applied. 1a therefore satisfies
observables O1, O3, and O6 and promotes no acceptance criterion, because the one criterion in reach
compares projection snapshots and no projection exists.

1b builds that projection. Its charter from the roadmap: projection work must be idempotent,
checkpointed, observable, and repairable, and failed work may not silently lose the canonical
evidence. It must do all of that without changing a reader answer.

**Delivers:** observables O2 and O4; boundaries B2, B3, B4; promotes the `capture-idempotency`
criterion.

**Explicitly out of scope:** lexical (FTS5) and dense (embedding) projection rebuild, which the
roadmap assigns to Gate 2; canonical tombstones and the concurrency harness (1c); reconciliation
against the current path (1d).

## The criterion this gate promotes

Held verbatim in the append-only
`tests/long-term-memory/acceptance/predicate-registrations.ts` under key `capture-idempotency`:

> Replaying an identical capture input, repeatedly and with ingest order reversed relative to event
> time, yields exactly one canonical event per idempotency identity, and the projection snapshot
> after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by
> event time, never by ingest order. Every suppressed replay is observable as a duplicate
> suppression, never as a silent success.

1a already satisfies the first clause (one event per identity) and the third (every suppressed
replay records a `suppressed-duplicate` attempt). 1b owes the byte-identical snapshot and the
event-time resolution.

## Decisions

### 1. The projection writes to a shadow table, not to `memory_records`

Dark mode forbids changing reader answers, and readers query `memory_records` today. The projection
therefore writes to a new `memory_projection_records` that no reader touches.

The alternative considered and rejected was computing the snapshot on demand by folding canonical
events, storing nothing. That collapses 1b into a serializer: with no applied state, B3
("mid-projection, with partial writes applied") has nothing to be partial about and the checkpoint
means nothing, so B2–B4 would go unsatisfied and an idempotent, repairable *apply* would have
nothing to be idempotent about.

Rebuilding the lexical and dense projections in the same pass was also rejected. The roadmap gives
that to Gate 2 explicitly, and pulling it forward would put the embedding path — which carries real
cost and an embedding-version gate — ahead of the record-level replay contract that justifies it.

### 2. Apply is a pure function of the canonical event row

Given a pending outbox position, apply reads the referenced canonical event, computes its
projection key, and upserts the shadow row if that event wins the key. It does not branch on the
outbox row's `op`.

This collapses `capture` and `observe` into one path. An `observe` item exists because 1a advanced
`last_observed_at` on the canonical event; since the event row already carries that monotonic max,
re-upserting the winning event picks it up without a second code path. `op` survives as an O3
observability field, which is what it was for.

The consequence that matters for repair: applying a position twice, or out of order, re-derives from
the log and converges. Re-driving work is therefore safe by construction rather than by policy.

### 3. Supersession resolves by event time; the event log stays append-only

1a captures a content-changing `updateMemoryRecord` as a *new* canonical event with its own
idempotency identity. The old event remains, `supersedes` is null on both, and both carry the same
`record_id`. The shadow table must decide which is live.

The winner for a projection key is the event with the greatest `event_time`; ties resolve on
`idempotency_identity` ascending. The tie-break must be deterministic and content-derived because
byte-identity depends on it — `event_id` is a `randomUUID` and cannot serve, and `ingest_time` is
the ordering the criterion forbids.

Populating `supersedes` at apply time was rejected. It would make apply mutate the canonical event
log, which is append-only apart from `last_observed_at`, and the value written would depend on the
order the worker happened to process rows — the same ingest-order dependence the criterion forbids,
one level down. Keeping `supersedes` null in 1b confines all order sensitivity to a fold that is a
pure function of event time.

### 4. Null `record_id` events project under their identity

`record_id` is null on canonical events captured when `saveMemoryRecord` was suppressed. Keying the
fold on `record_id` alone would leave those events with no shadow row.

The projection key is therefore `record_id` when non-null and `idempotency_identity` otherwise, so
every canonical event reaches the snapshot. Dropping them would leave 1d unable to distinguish
"correctly not projected" from "lost".

### 5. Per-item atomicity; the checkpoint is derived, not stored

Each outbox row is applied in one transaction that writes the shadow row and sets the outbox row to
`complete`. There is no separate checkpoint write: the checkpoint *is* `max(position)` over
completed rows, computed on read. No column is added to `memory_canonical_state`.

This makes B3 and B4 unreachable by construction, following the precedent 1a set with B1. O4
requires B1–B5 to be *holdable deterministically by a test*; it does not require them to be
reachable, and a boundary proven unreachable is stronger evidence than a boundary tested at.

The cost is one transaction per outbox row rather than one per batch. In a synchronous `bun:sqlite`
WAL runtime over a queue fed at human conversation rates, that is not a live constraint. Batching
can be introduced later behind the same drain interface, at which point B3 and B4 become reachable
and earn their fault-injection tests.

A batch transaction with a stored checkpoint was the honest alternative and would be correct if
throughput were a concern. It was rejected because it buys reachable boundaries at the price of a
state machine that can lose the checkpoint independently of the work — a failure 1d would then have
to distinguish from a real capture discrepancy.

### 6. Failure, retry, and repair

A failing apply rolls back. A **separate** transaction then increments `attempt_count` and sets
`last_error` and `last_attempt_at` — separate for the same reason 1a's `recordFailure` is, because
it must survive the rollback that erased the first attempt's writes.

At `attempt_count >= 5` the row moves to `failed` and the drain stops selecting it. The canonical
event is never touched, satisfying the roadmap's requirement that failed work not silently lose the
canonical evidence. Repair is re-driving `failed` rows to `pending`, which makes repair a data
operation over existing machinery rather than new machinery.

Unbounded retry was rejected: a poison row retried forever makes outbox depth ambiguous, since a
large backlog and a single stuck item look identical from outside. A terminal state keeps the two
separately countable through the `state` and `attempt_count` fields O3 already exposes.

Each drain run applies at most 200 items. When it stops at the cap with rows still pending it logs
the remaining depth, so a bounded run is never mistaken for a drained queue.

### 7. The drain is explicitly invoked; the scheduler is a separate wiring step

`drainProjectionOutbox()` is a self-contained function with no scheduling knowledge. That is what
makes B2–B4 holdable: a test drives the drain directly and can stop between any two steps.

Production wiring is one `scheduler.register` in `src/scheduler-instance.ts`, alongside the existing
`long-term-memory-maintenance`, `memory-capture-sweep`, and `memory-promotion-sweep` registrations.
It is a separate implementation task from the drain function, so the boundary tests never depend on
the scheduler.

Draining inline after each capture was rejected outright: it puts projection work on the capture
path, so a slow or failing apply becomes a latency and failure source for `saveMemoryRecord` — the
exact coupling dark mode exists to prevent — and it would make B2 unobservable, since no gap would
exist between outbox commit and work starting.

### 8. Kill switch

`MEMORY_CANONICAL_PROJECTION` defaults **ON**, disabled only by the exact string `'off'` — the same
inverted shape as `MEMORY_CANONICAL_CAPTURE`, and deliberately the inverse of
`MEMORY_SHADOW_LOG_ENABLED`.

Defaulting it off would make 1d unfalsifiable: the shadow table would be empty in every real
deployment, so the gate's exit reconciliation would compare the live path against nothing and pass
trivially. A gate exitable only under a value no deployment sets is not a gate. The cost of ON is
bounded — writes reach one table no reader queries, work is capped by outbox depth, and one
environment variable disables it.

## Schema

`memory_projection_records`, in `src/db/memory-projection-schema.ts`, created by migration
`078_memory_projection_records`:

| Column                 | Notes                                                     |
| ---------------------- | --------------------------------------------------------- |
| `projection_key`       | primary key; `record_id` when non-null, else identity     |
| `record_id`            | nullable                                                  |
| `event_id`             | the winning event, for 1d traceability                    |
| `idempotency_identity` | also the tie-break key                                    |
| `content_identity`     |                                                           |
| `scope_id`             |                                                           |
| `scope_type`           | `personal` \| `group`                                     |
| `thread_context_id`    | nullable                                                  |
| `kind`                 |                                                           |
| `content`              |                                                           |
| `summary`              | nullable                                                  |
| `tags`                 | JSON array                                                |
| `confidence`           |                                                           |
| `source`               |                                                           |
| `actor_ids`            | JSON array                                                |
| `provenance`           | JSON object                                               |
| `event_time`           | the fold's ordering key                                   |
| `last_observed_at`     | monotonic event-time max, carried from the winning event  |
| `valid_from`           | nullable                                                  |
| `valid_until`          | nullable                                                  |
| `expires_at`           | nullable                                                  |
| `schema_version`       |                                                           |
| `capture_version`      |                                                           |
| `projected_at`         | operational only; excluded from the snapshot              |

Index on `(scope_type, scope_id)`.

## The snapshot

`projectionSnapshot(scope)` reads shadow rows for the scope ordered by `projection_key` ascending,
projects the replay-stable field set, and serializes with the same `stableStringify` that backs
`canonicalJson` — imported, never reimplemented, for the same reason `contentHash` is imported from
`tombstone.ts`: two serializers meant to agree eventually will not.

`stableStringify` is currently module-private in `src/long-term-memory/canonical-identity.ts`. 1b
exports it. That is the whole change to that file — no behavior moves, and `canonicalJson` keeps
using it unchanged.

**Included** — every field derived from the winning event, whose selection is fixed by event time
and therefore unreachable by ingest order: `projection_key`, `record_id`, `idempotency_identity`,
`content_identity`, `scope_id`, `scope_type`, `thread_context_id`, `kind`, `content`, `summary`,
`tags`, `confidence`, `source`, `actor_ids`, `provenance`, `event_time`, `last_observed_at`,
`valid_from`, `valid_until`, `expires_at`, `schema_version`, `capture_version`.

`last_observed_at` is included deliberately. It looks ingest-dependent and is not: 1a advances it by
monotonic event-time max, so any ingest order converges on the same value. Excluding it would leave
that property — a designed one, not an accidental one — unasserted.

**Excluded** — genuinely ingest-order-dependent, and including any of them would make the criterion
unsatisfiable for reasons unrelated to correctness: `event_id` (a `randomUUID`, fresh every run),
`projected_at`, and every outbox field (`position`, `attempt_count`, `enqueued_at`,
`last_attempt_at`, `last_error`).

**The snapshot is defined at quiescence** — the outbox drained. That is the only point at which
byte-identity is a meaningful claim; mid-drain the shadow table is legitimately partial.

## Observable contract

| Observable                | Satisfied by                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **O2** projection-snapshot | `projectionSnapshot(scope)` — key-ordered, replay-stable field set, `stableStringify` serialization, defined at quiescence |
| **O4** capture-suspension  | B2 held by not invoking the explicit drain; B3 and B4 held as unreachable, asserted by mid-transaction fault injection      |

O4 names all five boundaries. 1b holds B2–B4; B1 is already held by 1a; B5 belongs to 1c, which
introduces erasure. O4 does not close until 1c lands.

## Files

- Create `src/db/memory-projection-schema.ts`
- Create `src/db/migrations/078_memory_projection_records.ts`
- Create `src/long-term-memory/projection-config.ts` — `isCanonicalProjectionEnabled()`
- Create `src/long-term-memory/projection-apply.ts` — `applyOutboxItem()`, fold-winner comparison
- Create `src/long-term-memory/projection-drain.ts` — `drainProjectionOutbox()`, retry and cap policy
- Create `src/long-term-memory/projection-snapshot.ts` — `projectionSnapshot(scope)`
- Modify `src/db/schema.ts` — re-export the new table
- Modify `src/long-term-memory/canonical-identity.ts` — export `stableStringify`, no behavior change
- Modify `src/scheduler-instance.ts` — one `scheduler.register` for the drain

Each new module stays small and single-purpose: schema, config, apply, drain, snapshot. Splitting
apply from drain is what lets the boundary tests drive apply directly without the loop, and lets the
retry policy be tested without the transaction.

## Testing

Test-driven, per repo convention.

- **Idempotency (the promotion evidence).** Apply the same input N times, drain, snapshot; assert
  byte-identity with the snapshot after one. Repeat with ingest order reversed relative to event
  time.
- **Supersession by event time.** A later-`event_time` update applied before the earlier event still
  wins after the earlier one applies. The tie-break is asserted separately with equal event times.
- **B2.** Capture commits, the drain is not invoked; assert the outbox row is `pending` and no shadow
  row exists.
- **B3.** A raw SQLite `RAISE(ABORT)` fires mid-apply-transaction; assert zero shadow rows *and* the
  outbox row still `pending`, so the item retries whole. Same technique 1a used for B1.
- **B4.** Asserted unreachable: no state exists in which a shadow row is written and its outbox row
  is not `complete`.
- **Retry and terminal failure.** A persistently failing row reaches `failed` at five attempts, stops
  being selected, and leaves its canonical event unchanged.
- **Repair.** Re-driving a `failed` row to `pending` applies it and converges the snapshot.
- **Per-run cap.** With more than 200 pending rows, one drain applies 200 and reports the remainder.
- **Kill switch.** `MEMORY_CANONICAL_PROJECTION=off` drains nothing and writes no shadow row.
- **Snapshot field discipline.** Two runs producing different `event_id`s and `ingest_time`s yield
  byte-identical snapshots; a genuine content difference yields a different snapshot, so the test
  cannot pass vacuously.

The last test exists because of a defect this branch already produced: Task 3 of 1a shipped
assertions that a same-type field swap passed unchanged. An equality assertion that cannot fail is
worse than no assertion, because it reports coverage it does not have.

## What 1b leaves open

- **1c** — canonical tombstones and the concurrency harness. `op` remains an open enum for `'erase'`;
  the shadow table gains no erasure semantics here, and `memory_tombstones` is untouched.
- **1d** — reconciliation of `memory_projection_records` against `memory_records`, scoped to the
  cutover marker in `memory_canonical_state`. The shadow table's shape is chosen so that
  reconciliation is a table diff rather than a re-derivation.
- The asymmetric attempt-log gap named in the roadmap remains: a tombstone-suppressed *update*
  records no attempt row. 1b does not close it and must not be read as having done so.
