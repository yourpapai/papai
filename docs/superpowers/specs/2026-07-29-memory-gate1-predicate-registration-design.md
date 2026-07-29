<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1 — predicate pre-registration

**Status:** design

Precedes Gate 1 of
[`2026-07-26-memory-production-roadmap.md`](../plans/2026-07-26-memory-production-roadmap.md).
Extends the frozen contract in
[`2026-07-29-memory-gate0-acceptance-harness-design.md`](2026-07-29-memory-gate0-acceptance-harness-design.md).

## Problem

Gate 1's exit condition names tests that are Gate 0 criteria still marked `declared-unmet`:

> **Exit:** capture counts, scopes, payload identities, lag, failures, and erasure state reconcile
> with the current path; forget-versus-ingest and crash/replay tests fail closed.

"Forget-versus-ingest" is `races`. "Crash/replay" is `crash-recovery`. Reconciling payload
identities is `capture-idempotency`. All three carry the Gate 0 promotion rule:

> Predicate MUST be written and reviewed in this criterion's own follow-on spec, before its
> implementation begins.

So Gate 1 cannot both build canonical capture and author its own acceptance bar in one pass without
destroying the pre-registration property the harness exists to protect. A bar written by someone who
has already seen the implementation is not a bar.

The registry also has no state for the situation this spec creates. `registry.test.ts` asserts
`declared-unmet` implies `passPredicate` is null — the invariant that stops anyone claiming a
standard without evidence. "Predicate frozen, evidence not yet produced" is currently unrepresentable.

## Goals

- Freeze pass predicates for `capture-idempotency`, `races`, and `crash-recovery` before Gate 1's
  design session begins.
- Pre-register the criterion x shape cells Gate 1 must execute, including the `duplicate-out-of-order`
  and `long-horizon` shapes.
- Represent "predicate registered, criterion unmet" in the frozen contract without weakening the
  invariant that separates a standard from evidence.
- Make softening a registered predicate a visible act rather than a silent edit.
- Bind Gate 1's design to a stated set of observations, so the predicates are decidable against any
  implementation that provides them.

## Non-goals

- Implementing the three criteria, or any part of Gate 1. No `src/` changes.
- Promoting any criterion. The report's verdict stays `production ready = NO`.
- Pre-registering `contradiction`, `migration`, `backup-restore`, `load`, or `reader-quality`. Each
  gets its own spec at its own gate.
- Designing the canonical event schema. This spec fixes what must be *observable*, not how it is
  stored.

## Design

### 1. Predicate basis: observables, not schema

A predicate authored blind degrades into prose like "recovers correctly" — reads rigorous, decides
nothing. A predicate authored against a pre-committed schema is an implementation design wearing a
predicate's clothes, and forecloses Gate 1's choices before its design session.

The middle path: predicates are stated against **observations Gate 1 must make available**. Any
canonical-event and outbox implementation that provides the observations can be judged by them, and
Gate 1 keeps its freedom over storage, table layout, and worker structure.

This makes the observable list binding on Gate 1's design. That is the intended effect of
registering first, not a side effect.

#### Required observables

| Key                             | Requirement                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **O1** `canonical-enumerate`    | Canonical events enumerable per scope, keyed by idempotency identity and content identity, including attempts suppressed as duplicates. |
| **O2** `projection-snapshot`    | Deterministic, order-stable serialization of all projection state for a scope, comparable byte-for-byte across runs.                  |
| **O3** `outbox-inspect`         | Outbox items enumerable with state, attempt count, and checkpoint position.                                                          |
| **O4** `capture-suspension`     | Boundaries B1-B5 are holdable deterministically by a test.                                                                           |
| **O5** `tombstone-enumerate`    | Tombstones enumerable with registration time, independently of the records they suppress.                                            |
| **O6** `outcome-reporting`      | Every capture attempt returns a distinguishable outcome: `captured`, `suppressed-duplicate`, `suppressed-tombstoned`, or `failed`.    |

#### Declared boundaries

| Key    | Boundary                                                    |
| ------ | ----------------------------------------------------------- |
| **B1** | Between the canonical write and the outbox write.           |
| **B2** | After outbox commit, before projection work starts.         |
| **B3** | Mid-projection, with partial writes applied.                |
| **B4** | After projection, before the checkpoint advances.           |
| **B5** | During erasure, between the tombstone write and cleanup.    |

### 2. The three predicates

**`capture-idempotency`** — registered cells: `duplicate-out-of-order`, `long-horizon`

> Replaying an identical capture input, repeatedly and with ingest order reversed relative to event
> time, yields exactly one canonical event per idempotency identity, and the projection snapshot
> after N replays is byte-identical to the snapshot after one. Supersession and validity resolve by
> event time, never by ingest order. Every suppressed replay is observable as a duplicate
> suppression, never as a silent success.

**`races`** — registered cells: `adversarial-erasure`, `multi-party`

> For every interleaving of an erasure request with an in-flight capture of the same subject or
> evidence, held at B1-B5, the terminal state is erased: no canonical event, outbox item, projection
> row, or index entry for the tombstoned identity survives, and the losing writer reports a
> tombstoned suppression or a failure, never success. Concurrent captures of one idempotency
> identity produce exactly one canonical event. No interleaving reaches a state that neither serial
> order can reach.

**`crash-recovery`** — registered cells: `long-horizon`, `duplicate-out-of-order`

> B1 is unreachable: no fault can leave a canonical event without its outbox item, or the reverse.
> For faults at B2-B5, restart converges the projection snapshot to the fault-free snapshot for the
> same input; canonical evidence committed before the fault is still enumerable; every outbox item
> is either complete or pending with its retry visible, never silently dropped; tombstones
> registered before the fault still suppress recapture after restart; and at-least-once redelivery
> produces no duplicate canonical event.

Two notes on the cell assignments.

`duplicate-out-of-order` sits under `crash-recovery` as well as `capture-idempotency` because
at-least-once outbox delivery makes crash recovery a *duplicate generator*. It is the same scenario
shape arriving from the failure path rather than the input path, and an implementation can plausibly
handle one source and not the other.

The B1-unreachability clause turns "canonical writes and the projection outbox commit atomically"
from a design adjective into a claim a test can falsify.

### 3. Registry model

Three changes to `tests/long-term-memory/acceptance/registry.ts`.

**Third criterion status.** `'implemented' | 'predicate-registered' | 'declared-unmet'`.

| Status                 | `passPredicate` | `blocker` | `predicateRule` | Executed cells |
| ---------------------- | --------------- | --------- | --------------- | -------------- |
| `implemented`          | required        | null      | null            | at least one   |
| `predicate-registered` | required        | required  | null            | none           |
| `declared-unmet`       | null            | required  | required        | none           |

`predicateRule` goes null on registration because the rule has been discharged. Leaving it would
assert the predicate still needs authoring.

`blocker` stays, because registering a predicate does not remove the reason the criterion has no
evidence. The blockers are unchanged: no write-boundary content-hash dedup, no concurrency harness,
no fault injection.

**`registeredShapes: readonly ShapeKey[]`** — cells the frozen predicate demands, which have no case
yet. Distinct from `shapes`, which stays the executed-cell list. Promotion moves keys from
`registeredShapes` into `shapes`.

The `duplicate-out-of-order` and `long-horizon` shape entries keep their `declared-unimplemented`
status — no fixture builder exists for either — but their `blocker` text is rewritten to cite this
registration and Gate 1 rather than the superseded capture-idempotency demotion. Shape status stays
a two-state fact about whether a fixture builder exists; registration is recorded on the criterion,
which is where the predicate lives.

**Registration log** — `tests/long-term-memory/acceptance/predicate-registrations.ts`, append-only,
entries of `{ date, criterion, spec, predicate }`. It is the anchor that lets a later promotion
commit be checked against the predicate as originally written, reusing the append-only drift-log
pattern the executed memory plans already use.

### 4. Grandfather list

The verbatim check cannot apply to the four criteria already `implemented`: their predicates were
authored in the Gate 0 spec, where the promotion rule permitted it, and no registration entry exists.

`GATE0_IMPLEMENTED: readonly CriterionKey[] = ['scope-isolation', 'erasure', 'provenance',
'reproducibility']` records that exemption explicitly.

Backdating registration entries for those four was rejected: it would fabricate a pre-registration
that never happened, in the one artifact whose entire value is that it does not lie. A closed
four-element list is itself a frozen contract term; growing it fails CI (§5) and is as visible in
review as softening a predicate would be.

### 5. Consistency invariants

Extending `registry.test.ts`, plus a new `predicate-registrations.test.ts`:

- Status invariants per the §3 table, for all three states.
- `registeredShapes` cells have **no** matching case in that criterion's `CASES` table — a criterion
  cannot quietly begin executing its registered cells while still holding `predicate-registered`.
- `shapes` cells keep the existing bidirectional cell-to-case check, in both directions.
- The existing "every deferred shape appears in no declared cell" invariant is scoped explicitly to
  `shapes`. `duplicate-out-of-order` and `long-horizon` are deferred shapes that now appear in
  `registeredShapes`, which is exactly what registration means; leaving that invariant unscoped
  would forbid registering a cell for a shape no fixture builder exists for yet.
- Every criterion whose status is not `declared-unmet` and whose key is not in `GATE0_IMPLEMENTED`
  has a registration entry whose `predicate` equals its `passPredicate` verbatim.
- `GATE0_IMPLEMENTED` contains exactly those four keys.
- Every registration entry carries a date and a spec path, and its `criterion` resolves to a known
  key.

### 6. Report

`report.ts` gains a third bucket. The summary line becomes
`contract versioned = YES / production ready = NO (4 implemented, 3 predicate-registered, 4 unmet)`.

The coverage matrix renders registered cells with a glyph distinct from executed cells, so "we
promised to test this" cannot be misread as "we tested this."

Exit code stays 0. Enforcement stays in the tests, per the Gate 0 design.

## Testing

Test-driven, per repo convention. The §5 invariants are written first — the tri-state status
assertions fail against today's two-state registry, then pass as it is extended. `report.test.ts`
gains assertions for the third bucket and the registered-cell glyph.

No criterion suite is added. `capture-idempotency`, `races`, and `crash-recovery` have no `CASES`
table until Gate 1, and the §5 invariants require that they have none.

## Consequences

Nothing is promoted. The report's verdict is unchanged and still `NO` — correctly, since three
criteria now have a standard and still no evidence.

What changes is that Gate 1 enters its design session with O1-O6 and B1-B5 already fixed. Its spec
must satisfy them or file an amendment.

**The amendment path is the risk to watch.** Gate 1 may find an observable unimplementable as
written. The escape is an append-only amendment entry: new date, superseding predicate, stated
reason, original left in place. An amendment is a visible, arguable act; an in-place edit is not.

Because that path is by construction always available, the failure mode is amending under schedule
pressure to make Gate 1 exit — the same pressure the pre-registration rule was written to resist.
An amendment whose reason is that the predicate proved hard to satisfy is a signal to re-examine
Gate 1's design, not the predicate.
