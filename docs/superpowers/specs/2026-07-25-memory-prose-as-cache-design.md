<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prose as Cache: Erasure Across Derived Memory (Audit Defect 5, slice 2)

Status: approved design, pre-implementation
Date: 2026-07-25
Branch: memory-vector-graph-research
Predecessor: `2026-07-24-memory-durable-erasure-design.md` (slice 1 — record purge, tombstones, `secure_delete`)

## Problem

Slice 1 made `forget_memory` destroy the canonical record: `purgeMemoryRecord`
deletes the row (taking the FTS entry and embedding with it), writes a
content-hash tombstone, and both background write paths consult that tombstone
before inserting (`capture.ts:126`, `runner.ts:121,149`). That part works.

It is also the wrong target. `memory_records` is the one channel that erasure
handles properly, and it is **opt-in and off by default** — `injectRecords`
defaults to `false` (`long-term-memory-schema.ts:16`), so records reach the
model only through an explicit `search_memory` call. Meanwhile the two channels
that reach the model on *every turn* survive a purge untouched.

Three residue channels at HEAD, each verified by reading the code:

1. **`memory_summary`.** A rolling LLM-written prose summary, loaded every turn
   (`conversation.ts:66`). `purgeMemoryRecord` (`store.ts:231`) does not touch
   it. It is also sticky: each trim folds the existing summary into the new one
   (`conversation.ts:130`), so content that reaches it never ages out.
2. **`memory_profiles.profile`.** Free-text prose about the user, written by a
   background LLM (`runner.ts:205`) and injected every turn *unconditionally* —
   independent of the `injectRecords` flag (`conversation.ts:70-74`).
   `purgeMemoryRecord` does not touch this table.
3. **Archived dedup duplicates.** `archiveDuplicates` (`promotion.ts:73`) calls
   `archiveMemoryRecord` (`store.ts:221`), which sets `status: 'archived'` and
   nothing else — content, evidence, FTS entry, and embedding all remain.
   Purging the surviving record deletes one row and tombstones one hash; the
   twins keep full copies. Their content is a *near*-duplicate, so its hash
   differs and the tombstone does not match them either. This is the original
   archive-instead-of-delete defect, still live on a path slice 1 deliberately
   left alone for dedup's legitimate use.

The structural cause is the same in all three: **nothing records where derived
content came from.** Profile prose, summary prose, and duplicate rows all lost
their link to the source the moment they were written. Every erasure mechanism
so far — content hashing, `LIKE` key reconstruction, scope re-derivation — is an
attempt to rebuild that lost link after the fact, and a lost link cannot be
reliably reconstructed.

## Goals

- **Erasure reaches every always-on channel.** After `forget_memory`, no
  derived artifact that feeds the prompt still carries the erased content.
- **Zero leak window.** Suppression is synchronous and transactional; it does
  not depend on a background worker, an LLM call, or a queue draining.
- **Fail closed.** Any failure in the asynchronous half leaves content
  suppressed, never exposed.
- **Dedup stops hoarding copies.** Losing a dedup comparison must not leave a
  full, un-tombstoned copy of the fact behind.
- **An honest, enforceable promise.** What `forget_memory` guarantees is stated
  precisely and holds, rather than being broadly implied and quietly broken.

## Non-goals

- **Span-level summary redaction.** Removing one fact from prose while keeping
  the rest requires attribution-tagged generation; the current literature covers
  attribution at generation time, not retroactive patching. Out of scope.
- **Rewriting conversation history.** Forgetting a memory does not edit what the
  user actually said. See "Scope of the promise".
- **Bounding the summary's fold-forward.** Unbounded folding is a quality
  concern (drift, compounding omission), not an erasure one, and is fully
  handled for erasure purposes by deletion-on-forget.
- **Canonical event log / outbox / versioned projections.** `06`'s
  `adopt-hierarchy` Phase 1 remains unbuilt and is not started here.
- **Backups, replicas, external copies.** Operator retention policy.

## Verified findings that shape the design

Established by reading the code during design, not assumed.

- **There is no message identity in this system.** `conversation_history` stores
  `ModelMessage[]` as JSON with no ids (`history.ts:21`). The `messageIds` in
  `evidence` are free strings the extraction LLM invents from a prompt
  instruction (`extractor.ts:27`, typed only as a capped string). They reference
  nothing. Any design joining derived artifacts to sources by message id would
  first have to introduce message identity across the append, trim, and cache
  paths.
- **The summary cannot be regenerated.** Its source messages were deleted by the
  trim that produced it. Regeneration is only possible for artifacts whose
  leaves persist — which is true of the profile (derived from records) and false
  of the summary.
- **Scope is a sufficient join.** The profile is one row per scope; purge is
  per scope. The summary is per storage key, and `scope-clear.ts` already has a
  verified helper mapping a scope to its storage keys, including group threads
  (`scope-clear.ts:34-37`, `eq(col, scopeId) OR col LIKE scopeId || ':thread:%'`
  with proper `LIKE` escaping). No new provenance table is needed at this
  granularity.
- **Cache eviction already exists and is already used by scope clear.**
  `evictUser(key)` per cleared key (`scope-clear.ts:111`).
- **`evidence` is content-free by convention, not by type.** `messageIds` is
  `string[]` with a 512-char cap, so a misbehaving extractor can put prose
  there. Contrast `buildShadowLogRow`, which hashes every raw string before it
  can cross into the row. Noted as a latent risk; not fixed here.

## Design

### 1. Tiering: what is durable, what is cache

| Tier | Role | Durability | Erasure mechanism |
| --- | --- | --- | --- |
| `memory_records` | The only durable truth. Atomic, addressable, individually erasable. | Durable | Purge + tombstone (slice 1) |
| `conversation_history` | Exact recent turns, capped at 100. | Ephemeral, self-healing via trim | Ages out |
| `memory_summary` | Session continuity only. | Ephemeral cache | Deleted on contamination |
| `memory_profiles.profile` | Derived rendering of records. | Cache | Suppressed, then regenerated |

The governing rule: **unstructured LLM prose is never durable truth.** An atomic
record can be deleted because it is one identifiable thing; prose is a blend of
many facts with nothing to address. This is the failure-side statement of `06`
§3's *"a summary or embedding must never be the sole surviving evidence copy"*.

Note that this requires **no new retention**. Raw turns are not kept longer. The
defect is treating prose as durable, so data at rest decreases.

### 2. Suppress synchronously, regenerate asynchronously

Add one column: `memory_profiles.contaminated_at` (text, nullable).

**On purge**, inside the existing `purgeMemoryRecord` transaction:

1. Delete the record; write the tombstone (unchanged from slice 1).
2. Set `contaminated_at` on the scope's `memory_profiles` row.
3. Delete `memory_summary` rows for the scope's storage keys, reusing the
   `scope-clear.ts` key helper.
4. After commit, `evictUser(key)` for each affected key.

**At the read path**, `buildMessagesWithMemory` (`conversation.ts:61`) omits a
profile whose `contaminated_at` is set.

**Asynchronously**, a regeneration worker rebuilds the profile from the scope's
remaining active records and clears the flag, reusing the existing background
profile-write path (`runner.ts:205`).

The leak window is zero: content stops reaching the model when the transaction
commits, not when the worker runs. Regeneration is quality restoration, never a
safety dependency. If the worker never runs, crashes, or its LLM call fails, the
profile stays suppressed — the failure mode is lost context, never leaked data.

This is stronger than the propagation guarantees of the reference architectures
surveyed (Kafka compaction has no completion guarantee; EventStore scavenging is
threshold-dependent), and it is stronger for a structural reason: suppression
requires no LLM call, no queue, and no external system.

### 3. Dedup must not hoard copies

`archiveDuplicates` (`promotion.ts:73`) switches from `archiveMemoryRecord` to
`purgeMemoryRecord` for the losers of a dedup cluster.

This is required for correctness of §2, not merely tidiness: regenerating the
profile from "remaining active records" is only sound if archived twins are not
sitting in the table still holding the erased fact.

`archiveDuplicates` is `archiveMemoryRecord`'s only production caller —
`runMemoryMaintenance` does its own inline status updates (`maintenance.ts:51`
for expiry, `:64` for staleness) rather than going through it. So this change
makes `archiveMemoryRecord` dead code, and it is deleted along with its direct
tests (`tests/long-term-memory/store.test.ts:182,225`). Leaving it would trip
knip and would leave an archive-instead-of-delete helper available for a future
caller to reintroduce the same defect.

Note the consequence: no code path produces `status: 'archived'` for dedup any
more. The `'archived'` enum value stays, since maintenance still writes it on
expiry.

### 4. Scope of the promise

`forget_memory` erases the fact from durable memory — records, indexes, profile,
summary — and prevents re-learning it. What the user actually said remains in
the live conversation window until it ages out normally.

This boundary is forced, not chosen. Deleting the summary does not durably
remove the fact, because the original message may still be in the 100-message
window and the next trim will summarize it back in. Tombstones cannot prevent
this: they work on extraction because records are atomic, and re-summarization
produces prose that no hash can match. The alternative — truncating history past
the purge — would rewrite the user's actual conversation, which is a larger harm
than the one being fixed.

The existing `forget_memory` confirmation gate (`e0df0929d`) states this, and
points at conversation clear as the complete option.

## Testing

Bilingual (EN + RU) golden set, extending
`tests/long-term-memory/durable-erasure.golden.test.ts`. Every test must be
shown to fail before the corresponding fix (red → green).

1. **Profile suppression is synchronous.** Seed a scope with a profile, purge a
   record, and assert — with no worker run — that `buildMessagesWithMemory`
   emits no profile content, and that `contaminated_at` is set.
2. **Fail-closed.** With the regeneration worker stubbed to throw, the profile
   remains absent from the prompt across repeated turns. Never exposed.
3. **Regeneration clears the flag.** After the worker runs, the profile is
   present again and rebuilt only from remaining active records.
4. **Summary deletion covers group threads.** For a group scope with a thread
   storage key, purging a record deletes `memory_summary` for both the main key
   and the thread key, and evicts both cache entries.
5. **Dedup losers are purged, not archived.** After a dedup collapse, assert no
   `archived` row retains the duplicate content, and that purging the survivor
   leaves no queryable copy at any status — including a raw
   `memory_records_fts MATCH` probe.
6. **The bounded promise holds as stated.** After purge, the fact is absent from
   profile, summary, records, and every retrieval channel; and the test asserts
   explicitly that raw `conversation_history` is *unchanged*, documenting the
   boundary as intended behavior rather than an oversight.

## Files touched (anticipated)

- `src/db/migrations/072_memory_profile_contaminated_at.ts` (new) +
  registration in `src/db/index.ts`.
- `src/db/long-term-memory-schema.ts` — `contaminatedAt` column.
- `src/long-term-memory/store.ts` — `purgeMemoryRecord` extended; profile read
  respects `contaminated_at`.
- `src/long-term-memory/scope-clear.ts` — export the scope→storage-key helper
  for reuse by purge.
- `src/long-term-memory/promotion.ts` — `archiveDuplicates` purges losers.
- `src/long-term-memory/store.ts` — delete the now-unused `archiveMemoryRecord`.
- `src/long-term-memory/runner.ts` — regeneration entry point.
- `src/conversation.ts` — skip contaminated profile.
- `src/tools/memory.ts` — confirmation copy for the bounded promise.
- Tests under `tests/long-term-memory/`.

## Rollout note

Migration 072 is additive (one nullable column); no backfill — existing rows
have `contaminated_at` null, meaning "not contaminated", which is correct for
records that were never purged.

Two behavior changes ship without a flag, both closing live defects: dedup
losers are destroyed rather than archived, and a purge suppresses the scope's
profile until it is rebuilt. Users may notice a temporarily thinner profile and
a reset session summary immediately after a forget. That is the intended cost of
the guarantee.
