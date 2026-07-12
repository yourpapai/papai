<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU3: nerv Scheduler Idempotency — Close the Residual Double-Dispatch Gaps (design)

> **Context.** Third sub-project of the post-migration follow-ups program. Hardens nerv's
> periodic-sweep → work-queue → magi-dispatch pipeline against the two ways a logical unit of work can be
> acted on twice: an overlapping sweep tick, and a crash/retry between a dispatch and its idempotency-ledger
> write. Closes the systemic concern flagged (but deferred) across the P1/P2 reviews.
>
> **Repos touched.** `nerv` (core) + `magi` (one small defensive fix). **papai: no code.**
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-13) in the nerv/magi repos.

## Premise (what the investigation established)

The exposure is **narrower and more specific** than "sweeps double-fire everything." The work queue's core is
already race-safe, so FU3 closes three residual gaps around it rather than rebuilding anything:

- **The claim is atomic.** `WorkQueue.claimNext` (`nerv/src/services/WorkQueue.ts:40-46`) is a single
  `findOneAndUpdate({status:'pending',…},{$set:{status:'processing'},$inc:{attempts:1}})` — two concurrent
  workers cannot claim the same `WorkItem`.
- **Enqueue dedupes while active.** A partial unique index on `dedupeKey`
  (`nerv/src/db/models/WorkItem.ts:46-49`, `partialFilterExpression: { status: { $in: ['pending','processing'] } }`)
  makes overlapping sweep ticks that try to enqueue the identical logical item collapse to one — **while that
  item is active**. Once it reaches `done`, a later tick can enqueue a fresh item with the same key (documented
  at `WorkItem.ts:45`), so the handler-level idempotency guard is the real last line of defense, not the index.
- **magi's follow-up/resume dedupe is correct.** `(parent_session_id, idempotency_key)` is enforced by a
  partial unique index in magi's `bun:sqlite` store (`magi/src/session/store.ts:102-104`), checked before the
  status gate, unconditional (no TTL/status scoping), persisted across restart, symmetric for follow-up and
  resume (`magi/src/session/continuation.ts:13-15,56-59,79-82`). P2's `idempotencyKey`s ship on the nerv side
  for review/CI/resume (`nerv/src/domain/idempotencyKeys.ts`).

### The three residual gaps FU3 closes

1. **No scheduler overlap guard.** `Scheduler.register` (`nerv/src/periodic/scheduler.ts:1-38`) does
   `setInterval(run, intervalMs)` and **discards** the promise `run()` returns — no in-flight flag, no
   `p-limit(1)`, no skip-if-running. With `forge-poll`/`assignee-watch` on 30–60s intervals doing sequential
   per-repo forge HTTP calls, a slow tick overlaps the next tick of the same sweep. The worker's own loop is
   self-guarded (chained `setTimeout`, `worker.ts:69-81`) — the `Scheduler` sweeps are not.
2. **Ledger-write-after-dispatch is non-atomic.** `makeReviewCommentHandler`
   (`nerv/src/supervisor/reviewHandlers.ts:77-87`) and `makePipelineFailureHandler`
   (`nerv/src/supervisor/ciHandlers.ts:80-90`) both do `await magi.followUp(...)` **then** a whole-document
   `task.save()` of `processedNoteIds`/`processedJobIds`. If `save()` fails or the process crashes after
   dispatch, the retry re-dispatches. Two problems: (a) the deterministic `idempotencyKey` downgrades that to a
   magi no-op **only for review/CI** (see gap 3 for the exceptions); (b) the whole-document save has no
   optimistic concurrency (`Task` schema sets no `optimisticConcurrency`, `Task.ts:94-113`), so a concurrent
   sweep/handler touching the same `Task` can lose an update.
3. **Two dispatch paths have no idempotencyKey and no ledger guard.** `makeChatInstructionHandler`
   (`nerv/src/supervisor/foundationHandlers.ts:181-209`) and `makeSelfReviewHandler`
   (`nerv/src/supervisor/selfReviewHandlers.ts:30-51`) call `magi.followUp` with **3 args** — no key. A
   retry-after-dispatch on these is an **unconditional duplicate** (no magi backstop). Neither payload carries a
   natural id (`ChatInstructionPayload { prompt }`, `SelfReviewPayload { projectPath, mrIid? }`), and hashing
   the prompt text would false-dedupe a legitimately repeated instruction.

## Decisions of record

1. **Don't rebuild the queue.** `claimNext` + the `dedupeKey` index are already race-safe; FU3 only closes the
   three gaps above.
2. **Atomic ledger write, keep the magi key.** Replace the handlers' whole-document `task.save()` of processed
   ids with an atomic `$addToSet` `findOneAndUpdate` on the positional `taskRepositories.$` element. Keeps
   dispatch→persist ordering (so the magi `idempotencyKey` remains the retry backstop) **and** removes the
   lost-update class. No lost-dispatch failure mode (unlike a claim-first gate, which was rejected).
3. **Skip-if-still-running** scheduler guard — generic, applies to all seven registered sweeps.
4. **Per-dispatch idempotency keys** for `chat_instruction` + `self_review`, keyed on `item._id.toString()`
   (available on every handler's `ctx.item`, stable across a retry of the same WorkItem, distinct across
   genuinely different dispatches). Per-dispatch — NOT per-task — because `self_review` legitimately re-fires on
   a `review → coding → review` cycle (`foundationHandlers.ts:124-138` re-enqueues on each transition into
   `review`); a per-task key would wrongly swallow the second review at magi's dedupe layer.
5. **magi is sound; harden only the race edge.** The `(parentId, key)` mechanism is correct and DB-enforced;
   the sole gap is that a unique-constraint violation (only reachable under multi-process or a future upstream
   `await`) surfaces as an **uncaught `SQLiteError` → HTTP 500** instead of a graceful "return the existing
   child." magi's own comment (`store.ts:99-101`) prescribes the fix. Apply it.

---

## Component A — scheduler overlap guard (nerv)

`nerv/src/periodic/scheduler.ts` — in `register`, wrap the existing `run` with a per-name in-flight flag:

```ts
let running = false
const run = async (): Promise<void> => {
  if (running) {
    this.log.debug(`scheduled job "${name}" still running; skipping this tick`)
    return
  }
  running = true
  try {
    await handler()
  } catch (err) {
    this.log.error(`scheduled job "${name}" failed`, err)
  } finally {
    running = false
  }
}
```

Skip-if-still-running is correct for periodic idempotent sweeps: a skipped tick loses nothing because the next
tick re-observes current state. No unbounded backlog (unlike serialize-chaining). Applies uniformly to all
seven sweeps registered in `nerv/src/index.ts:76-109`.

**Test:** a handler that resolves only after being released (slower than its interval) is never entered
concurrently — assert `handler` in-flight count never exceeds 1 across several fired intervals, and a skipped
tick is debug-logged. (`tests/periodic/scheduler.test.ts` currently only tests instantly-resolving handlers.)

## Component B — atomic ledger writes (nerv)

Replace the whole-document `task.save()` of the processed-id ledger in **both** handlers with an atomic
positional `$addToSet` update, run **after** the (already-idempotent) dispatch:

**`reviewHandlers.ts`** (`:84-87` today):

```ts
await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey) // unchanged
await tasks.addProcessedNoteIds(task._id, repo.projectPath, payload.noteIds) // atomic $addToSet + lastActivity
```

**`ciHandlers.ts`** (`:87-90` today, notify stays strictly last per FU2):

```ts
await magi.followUp(repo.magiSessionId, prompt, credentials, idempotencyKey) // unchanged
await tasks.addProcessedJobId(task._id, repo.projectPath, String(payload.jobId)) // atomic $addToSet + lastActivity
// … then the best-effort notify block (unchanged FU2 ordering)
```

The new `TaskService` methods issue a scoped atomic update — e.g.:

```ts
async addProcessedNoteIds(taskId: Types.ObjectId, projectPath: string, noteIds: string[]): Promise<void> {
  await Task.updateOne(
    { _id: taskId, 'taskRepositories.projectPath': projectPath },
    {
      $addToSet: { 'taskRepositories.$.processedNoteIds': { $each: noteIds } },
      $set: { lastActivity: new Date() },
    },
  )
}
```

`$addToSet` is idempotent (re-adding an existing id is a no-op) and atomic per-document, so a concurrent
sweep/handler mutating the same `Task` cannot lose the ledger write — closing both the retry-duplicate window
(in concert with the magi key) and the lost-update class for this field. The handler returns immediately after,
so the now-stale in-memory `task` copy is not re-saved (avoiding a whole-document clobber). Only the processed
ids + `lastActivity` were persisted by the old `task.save()` in these handlers, so nothing else is lost.

## Component C — idempotency keys for chat_instruction + self_review (nerv)

Add to `nerv/src/domain/idempotencyKeys.ts`, matching the existing style:

```ts
export function chatInstructionIdempotencyKey(taskId: string, projectPath: string, workItemId: string): string {
  return `${taskId}:${projectPath}:chat:${workItemId}`
}
export function selfReviewIdempotencyKey(taskId: string, projectPath: string, workItemId: string): string {
  return `${taskId}:${projectPath}:selfreview:${workItemId}`
}
```

Pass them as the 4th arg to `magi.followUp` (`MagiClient.followUp`'s optional `idempotencyKey` param already
exists, `MagiClient.ts:101-114`):

- `makeChatInstructionHandler` (`foundationHandlers.ts:191`):
  `magi.followUp(repo.magiSessionId, promptWithPreamble, credentials, chatInstructionIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString()))`
- `makeSelfReviewHandler` (`selfReviewHandlers.ts:47`):
  `magi.followUp(repo.magiSessionId, prompt, credentials, selfReviewIdempotencyKey(task._id.toString(), repo.projectPath, item._id.toString()))`

`item._id` is the WorkItem's Mongo primary key — the same document is re-passed to the handler on every retry
(`worker.ts:59-61`), so the key re-derives identically on retry (magi dedupes the duplicate) while two distinct
instructions / two distinct self-review cycles get distinct keys (no false-dedupe).

## Component D — magi graceful dedupe under race (magi)

`magi/src/session/continuation.ts` — in `launchContinuation` (`:26-43`), wrap the `deps.store.create(createInput)`
call so a unique-constraint violation on `idx_sessions_parent_idempotency` is caught and turned into a re-query
that returns the already-created child, exactly as the store's own comment prescribes
(`magi/src/session/store.ts:99-101`):

```ts
try {
  child = deps.store.create(createInput)
} catch (err) {
  if (isUniqueConstraintViolation(err) && idempotencyKey !== undefined) {
    const existing = deps.store.findChildByIdempotencyKey(parent.id, idempotencyKey)
    if (existing !== null) return existing
  }
  throw err
}
```

The catch is **narrow** — only the partial-unique-index violation (detected by the bun:sqlite error
code/message), never swallowing an unrelated error. Single-process today this path is unreachable (JS
run-to-completion makes check→insert effectively atomic), but it makes the mechanism sound under a future
multi-process `MAGI_DB` deployment or any refactor that inserts an `await` upstream of `store.create` — turning
the current uncaught-500 failure mode into the intended graceful dedupe.

**Test:** through the manager/continuation path, simulate the constraint firing (e.g. a pre-existing child with
the same `(parentId, key)`, or a stubbed store that throws the constraint on `create` then returns the child on
re-query) and assert the caller receives the existing child, not a thrown error. (Today only
`store.test.ts:440-467` exercises the raw constraint at the store layer; nothing covers the graceful path.)

---

## Cross-repo contract summary

| #   | Area             | Repo | Change                                                                              |
| --- | ---------------- | ---- | ----------------------------------------------------------------------------------- |
| 1   | Scheduler        | nerv | skip-if-still-running guard in `Scheduler.register` (per-name in-flight flag)       |
| 2   | Ledger write     | nerv | atomic `$addToSet` `updateOne` for `processedNoteIds`/`processedJobIds` (review+CI) |
| 3   | Idempotency keys | nerv | new `chat_instruction` + `self_review` keys, keyed on `item._id`                    |
| 4   | Dedupe race edge | magi | catch unique-constraint on `store.create` → re-query, return existing child         |

No wire-contract change: Components 1–3 are nerv-internal; Component 4 is magi-internal (both already speak the
existing `idempotencyKey` protocol). No papai involvement.

## Testing strategy

- **The missing race test (nerv).** Dispatch succeeds, then the handler is re-invoked (simulating a retry after a
  crash between dispatch and persist): assert the atomic `$addToSet` leaves the ledger correct with no
  lost-update, and that `magi.followUp` on the retry carries the SAME `idempotencyKey` (the magi backstop). Also
  a concurrent-invocation variant asserting `$addToSet` idempotency (the processed id appears once).
- **Scheduler overlap (nerv).** A slow handler outliving its interval is never entered concurrently; the skipped
  tick is debug-logged.
- **New keys (nerv).** `chatInstructionIdempotencyKey`/`selfReviewIdempotencyKey` re-derive identically for the
  same `item._id` and differ for different ids; the two handlers pass the 4th arg (assert the value reaching
  `magi.followUp`); a second self-review cycle (new WorkItem) gets a distinct key.
- **Atomic ledger methods (nerv).** `addProcessedNoteIds`/`addProcessedJobId` add ids idempotently to the right
  repo element (multi-repo task: only the matching repo's array changes) and bump `lastActivity`.
- **magi graceful dedupe.** Constraint violation on `create` → re-query returns the existing child, not a throw;
  a non-constraint error still propagates.

## Out of scope / deferred

- **Rebuilding the queue/claim** — already race-safe (`claimNext` + `dedupeKey` partial unique index).
- **Broad `Task` optimistic concurrency** across all mutations — the targeted atomic `$addToSet` fixes the
  ledger race specifically; the sweep's own whole-document `mrSyncSnapshot` save (`sweeps.ts:209`) stays as-is: a
  snapshot is a cache, and a lost snapshot update merely re-diffs on the next tick (self-correcting, low harm).
- **Serialize-chain scheduling** — skip-if-running was chosen (no backlog growth).
- **Any magi change beyond the catch-and-requery** — the dedupe mechanism itself is correct and needs no rework.

## Open assumptions (resolve during planning)

- The exact `updateOne` positional filter for the nested `taskRepositories` array (`'taskRepositories.projectPath':
projectPath` + `taskRepositories.$`), and confirmation that the handlers need nothing from a returned document
  (they return immediately after the write).
- Whether the two handlers persist any field **other** than the processed ids + `lastActivity` via their current
  `task.save()` — confirm by reading the exact handler bodies so the atomic update is complete (no dropped
  write).
- The precise bun:sqlite unique-constraint error signature (code/message) to match in magi's
  `isUniqueConstraintViolation`, so the catch is narrow and never swallows an unrelated `SQLiteError`.
