<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2 — Usage Telemetry Recorder, Brainstorm

**Date:** 2026-05-19
**Parent plan:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Parent design:** [`../specs/2026-05-19-central-llm-billing-design.md`](../specs/2026-05-19-central-llm-billing-design.md)
**Phase 1 (merged):** [`../plans/2026-05-19-phase-1-central-llm-credentials-plan.md`](../plans/2026-05-19-phase-1-central-llm-credentials-plan.md)

Open exploration before the per-phase design and plan land. Goal: surface
options, name trade-offs, resolve the open questions the roadmap lists for
Phase 2, and check whether any code surface the parent design missed needs
to be added to scope.

## Surface area survey

The roadmap and parent design D5 list a `src/usage/` module subscribing to
`llm:end` plus a migration. A read of the actual emit code surfaces a
short list of gaps that the per-phase design must close.

| Location                                  | Today                                                                                                 | Phase 2 implication                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/llm-orchestrator-events.ts:153-202`  | `emitLlmEnd` payload does NOT carry `chatUserId` or `contextType`                                     | Extend the emit signature; recorder needs both to populate `chat_user_id` and `context_type`                                       |
| `src/llm-orchestrator-events.ts:184`      | All `llm:*` events go through `emitUser`, scope `{ kind: 'user', userId: contextId }` even for groups | Scope kind is misleading for groups but we still have `contextId` and we plan to pass `contextType` explicitly — leave scope alone |
| `src/debug/event-bus.ts:34`               | `emitUser` short-circuits when `listeners.size === 0`                                                 | Recorder MUST subscribe at startup so the bus always has ≥1 listener; otherwise events drop on the floor                           |
| `src/llm-orchestrator-support.ts:161-181` | `emitLlmError` already exists and fires on the throw path (`llm-orchestrator.ts:252`)                 | Recorder subscribes to both `llm:end` and `llm:error`; failure rows fall out for free                                              |
| `src/embeddings.ts:33-48`                 | `getEmbedding` calls `embed()` directly, no event emitted                                             | Embedding callsites need a direct recorder call (or a new emit); cannot rely on the orchestrator bus                               |
| `src/web/distill.ts:96-128`               | `distillWebContent` calls `generateText` directly with the small model, no event emitted              | Same — direct recorder call, `modelRole: 'small'`                                                                                  |
| `src/debug/state-collector.ts:74-85`      | Existing subscriber that wires `subscribe()`/`unsubscribe()` only when a debug client is connected    | Pattern to mirror but NOT to copy verbatim — the recorder subscribes unconditionally at startup                                    |
| `src/db/migrations/034_system_config.ts`  | Recent migration example, plain `db.run()` SQL                                                        | Migration 035 follows this shape                                                                                                   |
| `src/db/schema.ts:28`                     | `systemConfig` re-exported from `system-config-schema.ts`                                             | New Drizzle table in `llm-usage-events-schema.ts`, re-exported from `schema.ts`                                                    |
| `src/system-config.ts`                    | Recent Drizzle-using module (insert + select), good API shape to mirror                               | Recorder uses `getDrizzleDb()` + Drizzle insert; query module same pattern                                                         |
| `src/index.ts:74-83`                      | After `initDb()` + `seedSystemConfigFromEnv()`; calls into singletons (`scheduler`, `startScheduler`) | Add `initUsageRecorder()` after the system-config seed step                                                                        |

Net: ~10 files touched in `src/`, plus the new `src/usage/` module (4
files), plus the new Drizzle schema file, plus tests. The parent design
omits the emit signature extension; that's the most important
elaboration from this survey.

## Open question A — Three emitters or one?

The roadmap explicitly flags this:

> Main, small, and embedding use the same OpenAI client and could share an
> emitter; separate emitters might be cleaner per modelRole. Decide in
> phase 2 brainstorm.

Three options:

- **A1. Extend the bus.** Add `emitLlmEnd` calls from `embeddings.ts` and
  `web/distill.ts` with a new `modelRole` parameter and the rest of the
  fields. Recorder subscribes to `llm:end` and reads `modelRole` to
  decide which row shape to insert.
- **A2. Direct recorder API for non-orchestrator callsites.** Keep
  `emitLlmEnd` as-is for the main-model path (bus → recorder via
  subscriber). Add `recordEmbeddingUsage()` / `recordDistillUsage()`
  functions in `src/usage/recorder.ts` that the embedding and distill
  modules call directly. Two write paths, one DB sink.
- **A3. Direct API everywhere.** Remove the bus → recorder dependency.
  `invokeModel` calls the recorder directly after `emitLlmEnd`.

Trade-offs:

- A1 keeps a single subscriber pattern. Cost: now `embeddings.ts` and
  `web/distill.ts` import the event bus, which they don't today. Also
  the `llm:end` payload widens to fit all three modelRoles (some fields
  meaningless for embeddings: step_count, tool_call_count, message_count).
- A2 keeps the bus shape narrow (only the orchestrator emits) and treats
  embeddings/distill as bespoke. Cost: two code paths to maintain;
  symmetry breaks down the line if we add a fourth modelRole.
- A3 is the cleanest but couples `llm-orchestrator-invoke.ts` to the
  recorder, and adds another import edge in the hot path. The bus was
  introduced precisely so that consumers don't have to know about each
  other.

**Recommendation:** A2 — direct recorder API for embeddings and distill,
bus subscription for the main-model orchestrator path. Reasons:

1. The bus dispatch already exists for `llm:end` and we'd be duplicating
   it for nothing in the orchestrator path.
2. Embeddings have no meaningful step/tool/message counts. Forcing them
   through the bus payload either fakes those fields or makes them
   nullable, both ugly.
3. The recorder module presents a unified `recordUsage(payload)` API at
   its boundary; the source (bus vs direct) is hidden from callers.
4. Future fourth modelRole (e.g. dedicated "router" model) re-uses the
   same direct API.

Open subquestion: does `web/distill.ts` need the storage context? Today
it passes `storageContextId` through its public API. So we can attribute
distill usage to the correct subject. Good.

Open subquestion: where do embeddings get the storage context? Looking
at the callsites:

- `src/tools/save-memo.ts:38` — userId is in scope, that's the storage
  context for DMs (and for groups, this is the memo's user — which is
  arguably the right subject because memos are per-user even in group
  context).
- `src/tools/search-memos.ts:95` — same.

Recommendation: pass `storageContextId` and `chatUserId` to
`tryGetEmbedding` so they end up in the recorder row. The current
callsite already has both in scope.

## Open question B — Where does embedding token count come from?

Roadmap:

> Where does embedding token count come from when the call is made by
> `web/distill.ts`? May be unsupported by the provider — store NULL.

`web/distill.ts` is a `generateText` call, not an embedding — that
specific subquestion is misnamed in the roadmap. The real instances:

- `embeddings.ts` calls `embed()` from `ai`. The return shape is
  `{ embedding, usage? }`. The Vercel AI SDK populates `usage` if the
  underlying OpenAI-compatible response carries it (most do; some
  self-hosted endpoints don't). Already nullable in the SDK.
- `web/distill.ts` calls `generateText()`, which returns a `usage`
  field. Same story — provider may omit.

**Decision:** the design's `input_tokens` / `output_tokens` columns are
already NULLABLE per D5; recorder writes NULL when the SDK didn't
populate `usage`. No new work, just don't crash on null.

Open subquestion: `embed()` and `embedMany()` differ in shape. We use
`embed()` (single-value) everywhere today. If `embedMany()` shows up
later, the recorder writes one row per call (not per item) so the
arithmetic in the dashboard is "tokens / call" — fine for now.

## Open question C — Idempotency strategy

Roadmap:

> Idempotency: ULID per event, generated in-process. `event_id` is a
> primary key — duplicate inserts fail loudly in tests, never silently.

Design D5:

> `event_id` is the `identifier` in Stripe terms / `id` in CloudEvents
> terms. ULID generated in-process before the row is inserted.

Open question 5 in the parent design:

> `event_id` is a process-local ULID. If `recordUsage` ever runs outside
> the in-process handler (queue, retry), we want the id to be derived
> deterministically — e.g. `hash(responseId, occurredAt)`. v1 does not
> need this because the recorder runs synchronously on the bus.

Three options for v1:

- **C1. `ulid` package.** Time-sortable IDs, ~3KB dep. The codebase
  doesn't currently use `ulid`; introducing it just for this is an
  unnecessary dependency.
- **C2. `crypto.randomUUID()`.** Already used elsewhere (`memos.ts:15`,
  `recurring.ts:25`). Random, not sortable, but `occurred_at` does
  sorting for us. Zero new deps.
- **C3. Deterministic hash of `(responseId, occurredAt, modelRole)`.**
  Phase 4's future shape. Costs nothing today, but the data model
  decision should be Phase 4's, not Phase 2's.

**Recommendation:** C2 — `crypto.randomUUID()`. Matches existing
codebase. Phase 4 can change to deterministic if/when the recorder
leaves the in-process bus. Don't paint the table into a deterministic-id
corner before the outbox need is real.

"Duplicate inserts fail loudly in tests": the recorder will catch
DB exceptions and log at `error` level (per parent design D7 — "never
throw into the bus chain"). Tests that want to assert duplicate-insert
behavior either spy on the logger or assert row count via the query
helper. Acceptable.

## Open question D — Subscribing at startup vs on-demand

`src/debug/event-bus.ts:34` short-circuits when no listeners are
registered:

```ts
export function emitUser(type: string, userId: string, data: Record<string, unknown>, turnId?: string): void {
  if (listeners.size === 0) return
  dispatch(makeEvent(type, data, { kind: 'user', userId }, turnId))
}
```

`state-collector.ts:74-85` subscribes only when the first debug client
connects and unsubscribes when the last one disconnects, leveraging that
short-circuit to keep the dispatch path cold when nobody is watching.

The recorder must subscribe **at process start**, unconditionally,
because usage rows are needed whether or not a debug client is open.
This has a side effect: `listeners.size` is now always ≥1, so the
short-circuit never fires. The full `dispatch()` path runs on every emit
— including `state-collector`'s `onEvent` if it's also subscribed.

Is that a problem?

- `dispatch()` is an in-process Set iteration. With 1–2 listeners and no
  network/disk in the hot path of the loop, the cost is negligible.
- The expensive bits of the payload build (`buildStepsDetail`,
  `estimateToolSchemaBytes`, JSON walking) happen inside
  `emitLlmEnd`/`emitLlmStart` BEFORE the call to `emitUser`. So they
  already run regardless of listener count. We're not regressing
  anything by ensuring the listener exists.
- `state-collector.ts:101` `onEvent` first checks
  `isVisibleToAdmin(event.scope, ...)`. If admin visibility hasn't been
  configured yet, events are dropped. So `state-collector` doesn't do
  meaningful work for non-admin scopes regardless.

**Decision:** recorder calls `subscribe(handler)` in `initUsageRecorder()`,
which is called from `src/index.ts` after `seedSystemConfigFromEnv()`.
No teardown — the recorder lives for the process lifetime. The graceful
shutdown path in `src/index.ts:154` doesn't need to call back into the
recorder.

## Open question E — Bus subscriber vs direct insert: failure isolation

Design D7:

> The recorder catches and logs its own errors; it must never throw out
> into the event bus subscriber chain because that would block other
> subscribers (state collector, telemetry).

`event-bus.ts:29-31` `dispatch()` iterates `listeners` with NO try/catch
around individual `fn(event)` calls. If a listener throws, the loop
terminates early. Confirmed by reading the code.

Therefore the recorder MUST catch internally. Pattern:

```ts
function onEvent(event: DebugEvent): void {
  try {
    if (event.type === 'llm:end') recordFromLlmEnd(event)
    else if (event.type === 'llm:error') recordFromLlmError(event)
  } catch (error) {
    log.error({ err: error, eventType: event.type }, 'usage recorder failure')
  }
}
```

Open subquestion: should we wrap _every_ listener in `dispatch` with a
try/catch defensively? That's a broader-than-Phase-2 change to the bus.
Not in scope; flag for a follow-up.

## Open question F — `chat_user_id` and `context_type` propagation

`emitLlmEnd` today takes `(contextId, mainModel, result, startTime,
messages, tools, routing, turnId)`. Missing: `chatUserId`, `contextType`.

Both are available in `invokeModel`:

- `chatUserId` — present in `processMessage` (`llm-orchestrator.ts:220`)
  and would need to be threaded through `callLlm` → `invokeModel`.
- `contextType` — already at `processMessage` (line 223), threaded into
  `callLlm` (line 245).

Two options:

- **F1. Add to the event payload.** Extend `emitLlmEnd`'s signature to
  take `chatUserId` and `contextType`. Plumb through `invokeModel`'s
  args (`InvokeModelArgs` in `llm-orchestrator-types.ts:55`). One-line
  payload addition in events.ts.
- **F2. Add to the scope.** Already established: scope kind for groups
  would be `{ kind: 'group', groupId }` via `emitGroup`. But scope
  doesn't carry `chatUserId`. So at minimum we still need to extend
  payload for `chatUserId`. Switching to `emitGroup` for groups is a
  separate cleanup orthogonal to Phase 2.

**Recommendation:** F1. Extend payload only. Leave the scope-kind
inconsistency for a future cleanup.

Open subquestion: `emitLlmError` (`llm-orchestrator-support.ts:161`)
currently takes `(contextId, _configContextId, error, turnId)`. To
populate `chat_user_id` and `context_type` on failure rows, extend that
signature too. Caller (`llm-orchestrator.ts:252`) has both in scope.

## Open question G — `storage_context_id` semantics

Design D5:

> `storage_context_id` is the "billable subject" key. For DMs that is
> the user id; for groups, the group id (or `groupId:threadId`). Same
> value `bot.ts` passes to the orchestrator as `contextId`.

So the column directly mirrors `processMessage`'s `contextId` arg. For
thread-scoped groups (Telegram, Mattermost), this is `groupId:threadId`;
for Discord, just `groupId` (per CLAUDE.md: "Discord group contexts are
not thread-scoped today"). Recorder treats `contextId` opaquely. Good.

Open subquestion: does any consumer want to roll up across threads of a
single group? Phase 3's billing tab might want that. We can't
reconstruct `groupId` from `groupId:threadId` without parsing the
string. Solution:

- For now, store `storage_context_id` verbatim. Phase 3 can split the
  string on `:` if it wants a group-level roll-up; alternatively, Phase
  3 may add a `parent_storage_context_id` column. Phase 2 does NOT
  speculate.

## Open question H — Query module surface

Roadmap:

> `query.ts` — read helpers (used by phase 3 but landed here so the
> public surface is testable end-to-end).

What exactly to ship in Phase 2:

- **H1. Just what's tested.** `listSubjects(window)`,
  `getSubjectDetail(id, window)`, both with a window argument that
  filters by `occurred_at`. Returns rows ready for the dashboard
  shape (per design D6).
- **H2. Just count + raw queries.** Bare functions to count rows,
  select by subject, no aggregation logic. Phase 3 builds the rollup.
- **H3. Everything in design D6.** Both the list and detail shapes,
  fully aggregated by model_role.

**Recommendation:** H1, scoped to the design D6 shapes. The Drizzle
query is small; landing it in Phase 2 with tests proves the schema
supports the queries we'll need. Phase 3 then just wires the routes.

Open subquestion: window selector values. Roadmap Phase 3 says
"24h / 7d / 30d / all" for the UI. Phase 2 query takes a `windowMs`
number (or `null` for "all") and lets Phase 3 map labels to numbers.

## Open question I — Drizzle schema vs raw SQL in the migration

The migration is the source of truth for the table. The Drizzle table
in `src/db/llm-usage-events-schema.ts` is the type surface for the
recorder and query module. They must agree.

Two options:

- **I1. Migration uses raw SQL (matching `034_system_config.ts`),
  Drizzle table is hand-written separately.** Two places to keep in
  sync. Tests assert the DB shape (columns, indexes, PK) so drift is
  caught.
- **I2. Migration uses Drizzle to create the table.** Avoids hand-sync
  but the migration runner uses `bun:sqlite` `Database` directly, and
  the Drizzle runner expects a different connection shape. Looking at
  `034_system_config.ts:13-22`: it's plain `db.run(SQL)`. Match that.

**Recommendation:** I1. Plain SQL in migration, hand-written Drizzle
table. Match the existing pattern. The migration test asserts schema
shape; a unit test on the Drizzle table asserts a round-trip insert →
select reads the same columns. Drift becomes a test failure.

## Open question J — Where to subscribe: state-collector or new module?

Option **J1**: extend `state-collector.ts` to also write rows.

- Pro: one subscriber, one place.
- Con: collector is for ephemeral SSE broadcasting; persistence
  responsibility doesn't belong there. Also collector subscribes
  on-demand; recorder needs unconditional.

Option **J2**: new `src/usage/` module with its own subscriber.

- Pro: clean separation, matches the parent design D5 sketch exactly.
- Con: another subscriber to register.

**Recommendation:** J2. The parent design already specifies the module
layout; deviating would be a regression in clarity.

## Open question K — What's in `src/usage/types.ts`?

Per parent design and roadmap:

- `UsageEvent` — the input shape for `recordUsage()`. Fields match the
  `llm_usage_events` columns plus a tagged `source: 'bus' | 'embedding' | 'distill'`?
  Probably not needed — the recorder just inserts; `modelRole` already
  distinguishes.
- `SubjectSummary` — the per-subject aggregate for the list view (per
  design D6 `BillingSubject`).
- `RequestRow` — one request row for the detail view (per design D6
  `BillingDetail['requests'][number]`).

Fields exposed by the query module are read-shape types; recorder's
input is a write-shape type. Keep them separate so the recorder type
doesn't grow display-only fields like `displayName`.

## Open question L — Test-DB pattern

Phase 1's `tests/system-config.test.ts` uses `setupTestDb()` from
`tests/utils/test-helpers.ts` which spins up a file-backed temp DB and
runs all migrations. Phase 2 tests follow that same pattern.

For migration-035 tests specifically (in `tests/db/migrations/`), copy
the `034_system_config.test.ts` pattern: `new Database(':memory:')` per
test, no migrations besides 035 (or run the chain up to 035).

For recorder unit tests, the cleanest path is DI: `recordUsage(payload, deps)`
where `deps.db` is injectable. Then tests pass an in-memory DB. Matches
the codebase's DI-first style for new modules (per `tests/CLAUDE.md`).
However, `src/system-config.ts` (the recent template) does NOT take a
db dep — it calls `getDrizzleDb()` directly, relying on `setupTestDb()`
to wire the singleton. Either approach is consistent with house style;
DI is preferred for new modules.

**Recommendation:** Pattern after `system-config.ts` (call
`getDrizzleDb()` directly, tests use `setupTestDb()`). Adding a
dependency parameter only complicates callsites in `embeddings.ts` and
`web/distill.ts` for no real test-isolation gain. The test-helper-based
setup already gives us a clean per-test DB.

## Things explicitly NOT to do in Phase 2

- No new dashboard routes. Phase 3.
- No dashboard UI / Billing tab. Phase 3.
- No `tool_call_events` per-tool table. Phase 4.
- No `forwarded_at` / outbox columns. Phase 4.
- No `/admin` DM command. Phase 3 (or never).
- No change to the existing `state-collector` behavior or subscriber
  lifecycle. The recorder is a parallel additive subscriber.
- No removal of `llm:error` event — keep it; recorder consumes both.
- No change to the chat-side context flow.
- No retroactive backfill: rows start being written from the
  Phase-2-deploy moment forward.

## Risks identified by the brainstorm that weren't in the parent doc

1. **Bus short-circuit on empty listener set.** Subscriber registration
   order in `src/index.ts` matters. `initUsageRecorder()` MUST run
   before any code path that could emit `llm:end` (i.e. before
   `setupBot`). The parent doc doesn't call this out explicitly.
2. **`emitLlmEnd` signature extension.** Parent design D5 says "the
   recorder reads from the bus rather than the orchestrator calling a
   function directly, so the orchestrator stays decoupled". Half true —
   the bus is the dispatcher, but the payload needs new fields
   (`chatUserId`, `contextType`) that the orchestrator IS responsible
   for putting there. This is a tightly bounded API extension, not
   coupling.
3. **`emitLlmError` payload is thinner.** It has `error`, `model`,
   `contextId`, `turnId` only. Recorder rows for the error path will
   have many NULL fields. Acceptable per the table schema
   (most fields nullable except `step_count`, `tool_call_count`,
   `message_count`, `duration_ms`, `storage_context_id`, `context_type`,
   `chat_user_id`, `model`, `model_role`, `event_id`, `occurred_at`).
   Need to relax NOT NULL on the count and duration fields for failure
   rows, OR provide sensible defaults: `0` for counts, `Date.now() - llmStartTime`
   for duration. Defaults are simpler and preserve the schema.

   The cleanest fix: extend `emitLlmError` to take the same context
   fields (`chatUserId`, `contextType`, `mainModel`, `startTime`,
   `messages.length`, `tools` count) and put defaults of 0 where there
   are no data.

4. **`buildStepsDetail` runs on every emit.** Already runs today; not
   new. Mentioned only because flagging the "always-on subscriber"
   change in (D) made me re-check it.
5. **Concurrent inserts.** With WAL mode (set at
   `src/db/index.ts:68`), SQLite handles concurrent inserts on a single
   table. Recorder is single-threaded inside Bun; not a real concern.
6. **`embeddings.ts` is currently a function-export module.** Threading
   `storageContextId`/`chatUserId` through `tryGetEmbedding(text, apiKey, baseUrl, model, deps)`
   means widening the signature. Callsites: 2 (`save-memo.ts:38`,
   `search-memos.ts:95`). Bearable. Alternative: accept an optional
   `context` object so old callers don't have to change. Lean toward
   required fields since they're always available at the callsites.
7. **TDD hook policy.** Same as Phase 1: every `src/` edit needs a
   failing test first. Plan must sequence T → I per file. The
   recorder + query module ship with their own tests under
   `tests/usage/`.

## Forward-compatibility check

- **Phase 3 (billing dashboard).** Query module already supplies the
  shapes; routes call them. Recorder is invisible to Phase 3 from a
  read-path perspective. ✓
- **Phase 4 (tool-call rows).** Adds a new table mirroring
  `llm_usage_events`. Recorder pattern reusable. Idempotency key
  becomes deterministic; v2 schema migration adds outbox columns to
  this table. No painted corners. ✓
- **Phase 5 (anonymous stats).** Counts and aggregates only; reads
  `llm_usage_events.occurred_at` for active-subject calculations.
  Already covered by indexes. ✓

No corners painted.

## Summary of decisions to lift into the per-phase design

1. **Subscriber lives in `src/usage/`** (new module), subscribed at
   startup, unconditional, no teardown. Wired in `src/index.ts` between
   `seedSystemConfigFromEnv()` and the chat-provider start.
2. **`emitLlmEnd` payload gains `chatUserId` and `contextType`.**
   `emitLlmError` gains the same fields plus optional `mainModel`,
   `startTime`, and `messageCount` so the failure-row insert can
   populate the same non-null columns as success rows.
3. **`InvokeModelArgs` gains `chatUserId` and `contextType`.** Plumbed
   from `processMessage` through `callLlm` to `invokeModel`.
4. **Embedding and distill callsites use a direct recorder API** —
   `recordUsage(payload)` — rather than emitting bus events. The bus
   path stays orchestrator-only.
5. **`crypto.randomUUID()` for `event_id`.** No `ulid` dependency.
   Phase 4 may switch to deterministic later.
6. **Drizzle table in `src/db/llm-usage-events-schema.ts`, re-exported
   from `schema.ts`.** Mirrors `system_config` layout.
7. **Migration 035 uses plain SQL** (matching `034_system_config.ts`),
   creates the table + four indexes per design D5.
8. **Recorder wraps internal work in try/catch and logs at `error`**
   level; never rethrows into the bus dispatch chain.
9. **Query module ships in Phase 2** with `listSubjects(windowMs)` and
   `getSubjectDetail(id, windowMs)` matching the design D6 shapes;
   tests assert aggregates against hand-rolled SQL.
10. **Failure rows still record** — recorder subscribes to both
    `llm:end` and `llm:error`. NOT NULL count/duration fields receive
    default 0 / elapsed-ms-since-start respectively on the error path.
11. **`storage_context_id` stores `contextId` verbatim** (including
    `groupId:threadId` for thread-scoped groups). Phase 3 / Phase 5
    decide whether to add a parent-id column later.

## Out of brainstorm (carry to plan, not design)

- Exact test file locations and the T-then-I ordering inside Step
  patterns.
- Whether to run `bun typecheck` after each substep or only at the end.
- Commit grouping strategy when the diff lands.
- Manual smoke checklist (write a message → row appears → fail a
  message → error row appears → verify subjects query).
