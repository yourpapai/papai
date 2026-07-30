<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Gate 1a — canonical capture spine

**Status:** design

First of four specs implementing Gate 1 of
[`2026-07-26-memory-production-roadmap.md`](../plans/2026-07-26-memory-production-roadmap.md).

Bound by the observables and boundaries frozen in
[`2026-07-29-memory-gate1-predicate-registration-design.md`](2026-07-29-memory-gate1-predicate-registration-design.md).

## Problem

The roadmap states Gate 1 as a single paragraph:

> Introduce exactly scoped canonical events, durable tombstones, provenance, version identities, and
> an atomic projection outbox. Dual-capture without changing reader answers. Projection work must be
> idempotent, checkpointed, observable, and repairable; failed work may not silently lose the
> canonical evidence.

Its exit adds reconciliation against the current path. Two of its criteria carry blockers that are
themselves programmes: `races` needs a concurrency harness, `crash-recovery` needs fault injection.

That is four independently reviewable deliverables wearing one gate's name. Executing it as one spec
would produce a change too large to review against its own frozen predicates, and would land the
concurrency and fault-injection harnesses in the same commit as the schema they are meant to
interrogate.

There is also nothing to build on. No canonical event log exists. Durable memory state today is
`memory_records` (FTS5 plus inline embeddings), `memory_profiles`, and `memory_tombstones`. Two
capture paths write it — `runMemoryCapture` (`src/long-term-memory/capture.ts:100`) and
`runMemoryExtractionInBackground` (`src/long-term-memory/runner.ts:232`) — and mutual exclusion
between them is a process-local `inFlight: Set<string>` (`runner.ts:84`) that vanishes on restart.

## Goals

- Decompose Gate 1 into four specs with explicit observable coverage and explicit promotion points.
- Deliver the canonical write spine: an event log, a projection outbox, and the identity model that
  makes duplicate capture decidable.
- Satisfy observables O1, O3, and O6, and make boundary B1 unreachable by construction.
- Capture in dark mode: no reader answer changes, and no canonical failure can affect the live write
  path.
- Leave O2, O4, and O5 unforeclosed for specs 1b and 1c.

## Non-goals

- Any projection, worker, or checkpoint. That is 1b.
- Canonical tombstones, the concurrency harness, or fault injection beyond B1. That is 1c.
- Reconciliation against the current path. That is 1d, and it is Gate 1's exit.
- Promoting any criterion. `capture-idempotency` cannot promote here: its predicate compares
  projection snapshots, and no projection exists until 1b.
- A retention policy for anything this spec writes. Retention is `backup-restore`'s registered
  blocker; answering it here would be Gate 1 quietly closing a question a later gate holds open.

## Design

### 1. Gate 1 decomposition

| Spec   | Delivers                                              | Observables    | Promotes                  |
| ------ | ----------------------------------------------------- | -------------- | ------------------------- |
| **1a** | event log, outbox, identities, dual-write             | O1, O3, O6; B1 | —                         |
| **1b** | dark projection, checkpoint, idempotent apply, repair | O2, O4; B2–B4  | `capture-idempotency`     |
| **1c** | canonical tombstones, concurrency harness             | O5; B5         | `races`, `crash-recovery` |
| **1d** | reconciliation against the current path               | —              | — (Gate 1 exit)           |

The ordering is forced by the frozen predicates, not by preference. `capture-idempotency` compares
projection snapshots, so it cannot close before 1b. `races` constrains erasure interleavings against
projection rows, so it cannot close before 1b and 1c both exist.

### 2. Event grain

A canonical event is **one captured memory item**, recorded when the extractor emits it, carrying
its idempotency identity, its content identity, and provenance back to the source turns.
`memory_records` becomes its projection.

The alternative — one event per observed turn, with extraction demoted to a projection worker — is
closer to the end state sketched in `06` §2–§3, but it is Gate 3's shape, not Gate 1's. Gate 1's exit
compares "capture counts, scopes, payload identities" against the current path, and that comparison
is only meaningful at capture grain. The three registered predicates agree: each is stated about
capture inputs and capture identities, and `capture-idempotency`'s blocker names the write boundary
explicitly.

### 3. Placement and failure isolation

The dual-write hooks `saveMemoryRecord`, for the reason that function's own docblock already gives:

> The tombstone check lives here rather than at the capture and extraction call sites so that a write
> path added later inherits the suppression instead of having to remember it.

Canonical capture is exactly such a concern. Hooking the choke point means both extractors and the
explicit `remember_memory` tool inherit it without knowing it exists.

The canonical write is **its own transaction**, separate from the live record write, and never
propagates a failure. This is forced by "dual capture without changing reader answers". It also keeps
B1 scoped to event-versus-outbox atomicity rather than dragging `memory_records` into the same
transaction, which is what B1's text actually constrains.

### 4. Schema

```text
memory_canonical_events
  event_id              TEXT PK
  idempotency_identity  TEXT NOT NULL UNIQUE
  content_identity      TEXT NOT NULL
  scope_type, scope_id  NOT NULL
  thread_context_id     TEXT
  kind, content, summary, tags, confidence, source
  actor_ids             TEXT   json, from evidence.actorIds
  provenance            TEXT   json: messageIds, threads, contextId
  event_time            TEXT NOT NULL
  ingest_time           TEXT NOT NULL
  last_observed_at      TEXT NOT NULL
  valid_from, valid_until, expires_at
  supersedes            TEXT   nullable; unresolved in 1a
  record_id             TEXT   nullable; the memory_records row, for 1d
  schema_version        INTEGER NOT NULL
  capture_version       TEXT NOT NULL
  INDEX (scope_type, scope_id, event_time)

memory_projection_outbox
  position       INTEGER PK AUTOINCREMENT
  event_id       TEXT NOT NULL -> memory_canonical_events
  op             'capture' | 'observe'
  state          'pending' | 'complete' | 'failed'
  attempt_count  INTEGER NOT NULL DEFAULT 0
  enqueued_at, last_attempt_at, last_error
  INDEX (state, position)

memory_canonical_capture_attempts
  position              INTEGER PK AUTOINCREMENT
  idempotency_identity  TEXT NOT NULL
  content_identity      TEXT NOT NULL
  scope_type, scope_id  NOT NULL
  outcome               'captured' | 'suppressed-duplicate'
                      | 'suppressed-tombstoned' | 'failed'
  event_id              TEXT   null when suppressed-tombstoned or failed
  event_time, ingest_time, capture_version

memory_canonical_state
  cutover_at     TEXT NOT NULL   single row; 1b adds the projection checkpoint
```

`UNIQUE(idempotency_identity)` makes "exactly one canonical event per idempotency identity" a
database constraint rather than a code convention. The identity already contains the scope, so global
uniqueness is the correct grain.

`position` is `AUTOINCREMENT` in both append-only tables: monotonic, never reused after deletion,
which is what 1b's checkpoint requires.

**No backfill.** The log starts empty and contains only events that actually went through the
canonical write path. The migration records `cutover_at`, and 1d scopes its reconciliation to records
created at or after it. Synthesising events for pre-existing records would assert that they were
captured canonically when they never were — the same fabrication the Gate 0 grandfather list refused
when it declined to backdate registrations for the four already-implemented criteria.

### 5. Identity

```ts
// src/long-term-memory/canonical-identity.ts
import { contentHash } from "./tombstone.js"; // imported, never reimplemented

// U+0000 separator: it cannot occur in a scope id or a hex hash, so no two
// distinct field tuples can join to the same string.
const join = (...parts: readonly string[]): string => parts.join("\u0000");

export const idempotencyIdentity = (
  scope: MemoryScope,
  content: string,
): string => sha256(join(scope.scopeType, scope.scopeId, contentHash(content)));

export const contentIdentity = (payload: CanonicalPayload): string =>
  sha256(canonicalJson(payload)); // sorted keys, sorted tags, explicit nulls
```

Reusing `contentHash` and `normalizeForHash` from `tombstone.js` is the point, not an economy. A
tombstone's stored `content_hash` is literally a component of the dedup key, so "is this tombstoned?"
and "is this a duplicate?" cannot disagree about what content means. 1c's forget-versus-ingest
interleavings depend on that agreement holding.

The two identities do different jobs. `idempotency_identity` decides whether two capture attempts are
the same attempt. `content_identity` is a hash over the full stored payload, so two attempts that
share an identity but differ in metadata are still distinguishable — which is what 1d compares when
the roadmap asks for payload identities to reconcile.

`event_time` is `max(evidence.timestamps)` when present, otherwise `createdAt`. It is deliberately
not `validFrom`: validity is a claim about the fact, event time is when the evidence occurred, and
only the latter makes "ingest order reversed relative to event time" a meaningful condition.

`capture_version` records which derivation rule produced a given identity. If `normalizeForHash` is
ever changed, every affected identity becomes attributable instead of silently reinterpreted.

### 6. The write

```text
captureCanonicalEvent(input, recordId) -> CaptureOutcome

db.transaction(() => {
  identity = idempotencyIdentity(scope, input.content)

  if (source !== 'explicit' && isContentTombstoned(scope, content)) {
    insertAttempt('suppressed-tombstoned')
    return 'suppressed-tombstoned'
  }

  existing = selectByIdentity(identity)
  if (existing) {
    advanced = max(existing.last_observed_at, eventTime)
    if (advanced !== existing.last_observed_at) {
      update last_observed_at = advanced
      insert outbox { event_id: existing.event_id, op: 'observe' }
    }
    insertAttempt('suppressed-duplicate')
    return 'suppressed-duplicate'
  }

  insert event
  insert outbox { event_id, op: 'capture' }
  insertAttempt('captured')
  return 'captured'
})
```

A re-observation advances `last_observed_at` to the maximum of the stored value and the incoming
event time. Because `max` is idempotent over a fixed event time, replaying an identical input changes
nothing; because it is a maximum over event time rather than ingest time, a genuinely later
observation still advances and reversed ingest order does not regress it. Both clauses of
`capture-idempotency` fall out of that one rule.

A pure replay therefore writes no event, advances no timestamp, and enqueues no outbox item — only
the attempt row O1 requires. That is what keeps a projection snapshot byte-identical after N replays
without special-casing, and it stops replay from growing the outbox without bound. The attempt log is
the one thing replay does grow; see Consequences.

There is deliberately no observation counter. A counter is not idempotent under replay, and nothing
in the frozen predicates or in 1b needs one.

**Failure recording.** A `failed` outcome means the transaction rolled back, which would roll back
its own attempt row. Failures are therefore recorded outside the failed transaction:

```ts
try {
  outcome = db.transaction(() => {
    /* … as above … */
  });
} catch (error) {
  try {
    db.transaction(() => insertAttempt("failed", error));
  } catch {
    log.error(/* … */);
  }
  outcome = "failed";
}
return outcome; // never throws
```

**B1 is unreachable by construction.** The event insert and the outbox insert are in one synchronous
`db.transaction()`. There is no await point between them for an interleaving to enter, and no partial
commit for a crash to leave behind. The established pattern is already in this subsystem
(`purge.ts:113`, `scope-clear.ts:109`).

### 7. Hook

Two call sites in `store.ts`, both after the live decision is made, neither able to change it:

```ts
if (input.source !== "explicit" && isContentTombstoned(scope, input.content)) {
  log.info(/* … */);
  captureCanonicalEvent(input, null); // -> 'suppressed-tombstoned'
  return null;
}
// … insert …
const saved = loadRecord(input.id);
captureCanonicalEvent(input, saved.id); // -> 'captured' | 'suppressed-duplicate'
return saved;
```

`captureCanonicalEvent` repeats the tombstone check rather than trusting its caller. The redundancy
is deliberate: it makes the function self-contained enough to test O6 directly, and it means both
paths reach the same verdict from the same data — which is what 1c's interleavings compare.

`updateMemoryRecord` also writes content (`runner.ts:145` drives it), so a content-changing update is
a real capture. 1a captures those: on a successful update where `patch.content` is defined, the
updated row is loaded and `captureCanonicalEvent` is called. Status- and confidence-only updates emit
nothing. Omitting this would leave a hole in canonical space that surfaces in 1d looking like a
defect rather than a declared gap.

**Kill switch.** Dark capture is on by default — it cannot change answers, and it accrues value only
by accruing data. `MEMORY_CANONICAL_CAPTURE=off` disables it entirely; when off there is no capture
attempt, and therefore no outcome and no rows.

### 8. Observable contract

| Observable                 | Satisfied by                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O1** canonical-enumerate | `memory_canonical_events`, unique by identity and indexed by scope and event time, plus `memory_canonical_capture_attempts` for suppressed attempts |
| **O3** outbox-inspect      | `memory_projection_outbox` — `state`, `attempt_count`, and `position` as the checkpoint position                                                    |
| **O6** outcome-reporting   | `CaptureOutcome` returned, and durably recorded for all four outcomes                                                                               |

**O1's reading is a decision, recorded here.** Its frozen text is:

> Canonical events enumerable per scope, keyed by idempotency identity and content identity,
> including attempts suppressed as duplicates.

The trailing clause admits two readings: that enumerating by identity finds the event a duplicate
attempt mapped to, or that suppressed attempts are themselves enumerable from storage. This spec
takes the second, stricter reading, which is why `memory_canonical_capture_attempts` exists.

The reason is the pre-registration property itself. This reading is being made with implementation
knowledge in hand, which is the exact bias the frozen contract exists to defeat; when ambiguous text
can be read as a higher or a lower bar, taking the lower one is indistinguishable from softening it.
Narrowing O1 by amendment was available and was rejected: O1 is not unimplementable as written, only
more work than the alternative, and that is the case the amendment warning was written for.

### 9. What 1a leaves open

1a must not foreclose the observables it does not deliver.

- **O2, B2–B4** — `position` is monotonic and never reused, which is what 1b's checkpoint needs. The
  event carries `supersedes` and half-open validity so 1b's projection can resolve supersession by
  event time rather than ingest order.
- **O5, B5** — `op` is an open enum that 1c extends with `'erase'`. Erasure state is not modelled in
  1a beyond the tombstone check, and `memory_tombstones` is untouched.
- **O4** — because the runtime is single-process synchronous SQLite in WAL, the interleavings that
  matter occur at `await` points in the extraction runners rather than under thread preemption. 1c's
  harness can hold those deterministically. 1a introduces no new await point inside a transaction,
  which is what keeps that true.

## Testing

Test-driven, per repo convention.

**Identity.** Determinism; canonical JSON stable under key and tag reordering; and an explicit
assertion that the `contentHash` component of an idempotency identity equals the `content_hash` a
tombstone stores for the same content. That last test is what keeps the two from drifting apart.

**Write algorithm.** All four outcomes reached; a pure replay adds no event, no outbox item, and no
timestamp change, and adds exactly one attempt row; replay with ingest order reversed against event
time leaves `last_observed_at` at the maximum; the UNIQUE constraint rejects a second event for one
identity.

**B1.** A fault injected between the event insert and the outbox insert leaves neither row. Plus the
enumeration invariant asserted in both directions: every event has at least one outbox item, and
every outbox item resolves to an event.

**Failure path.** A throwing insert records a `failed` attempt and does not propagate.

**Hook.** `saveMemoryRecord` returns exactly what it returned before, including when the canonical
write fails; the tombstone early return still records an attempt; a content-changing
`updateMemoryRecord` captures and a status-only one does not; the kill switch off writes nothing.

**No acceptance-registry change.** No criterion promotes, and `registry.test.ts` asserts that a
`predicate-registered` criterion exports no `CASES` table. 1a adds none for the three registered
criteria, and leaves `tests/long-term-memory/acceptance/` untouched.

## Consequences

Dark capture costs up to three row writes per memory write — event, outbox item, and attempt on a
first capture, one attempt row on a duplicate — plus a second tombstone lookup. The cost is
measurable and the kill switch reverses it.

The attempt log grows without bound under replay, and this spec declares no retention policy for it.
That is deliberate — retention is `backup-restore`'s registered blocker (`06` §6) — but it is a real
operational commitment, so 1d should report the table's size and make the growth visible rather than
discovered.

**The risk to watch** is silent divergence. The hook sits after the live path's decision, so canonical
space can drift from `memory_records` with nothing noticing. Nothing in 1a detects that; 1d is the
detector, and until 1d lands the divergence is invisible. This is the price of splitting the gate
four ways, and it is why 1d is a separately reviewed spec rather than a footnote on 1c.
