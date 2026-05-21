<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2 — Usage Telemetry Recorder, Per-Phase Design

**Date:** 2026-05-19
**Status:** Draft
**Branch:** `claude/phase-2-llm-billing-J6vnM`
**Parent design:** [`2026-05-19-central-llm-billing-design.md`](2026-05-19-central-llm-billing-design.md)
**Phase 1 (merged):** [`2026-05-19-phase-1-central-llm-credentials-design.md`](2026-05-19-phase-1-central-llm-credentials-design.md)
**Brainstorm:** [`../notes/2026-05-19-phase-2-usage-recorder-brainstorm.md`](../notes/2026-05-19-phase-2-usage-recorder-brainstorm.md)

This per-phase design refines parent §D5 ("Per-LLM-call usage row,
written from the event bus"). The parent doc covered the table schema
and forward-compatibility argument; this doc bakes in the brainstorm's
decisions on emit signatures, embedding/distill recording paths,
subscriber lifecycle, and the query module surface.

## D1. Table schema

Unchanged from parent §D5, repeated here for self-containment.

```sql
CREATE TABLE IF NOT EXISTS llm_usage_events (
  event_id           TEXT PRIMARY KEY,                -- crypto.randomUUID()
  occurred_at        INTEGER NOT NULL,                -- ms epoch
  turn_id            TEXT,                            -- nullable
  storage_context_id TEXT NOT NULL,                   -- billing subject scope
  context_type       TEXT NOT NULL,                   -- 'dm' | 'group'
  chat_user_id       TEXT NOT NULL,                   -- platform_user_id of caller
  model              TEXT NOT NULL,                   -- requested model id
  model_role         TEXT NOT NULL,                   -- 'main' | 'small' | 'embedding'
  input_tokens       INTEGER,                         -- nullable: provider may omit
  output_tokens      INTEGER,                         -- nullable
  step_count         INTEGER NOT NULL DEFAULT 0,
  tool_call_count    INTEGER NOT NULL DEFAULT 0,
  message_count      INTEGER NOT NULL DEFAULT 0,      -- context size at call time
  finish_reason      TEXT,                            -- nullable
  duration_ms        INTEGER NOT NULL,
  response_id        TEXT,                            -- nullable
  error              TEXT                             -- null on success
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_subject     ON llm_usage_events(storage_context_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_chat_user   ON llm_usage_events(chat_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_turn        ON llm_usage_events(turn_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_occurred    ON llm_usage_events(occurred_at);
```

Change from parent: `step_count`, `tool_call_count`, `message_count`
gain `DEFAULT 0` so the failure path (which doesn't have access to a
step/tool count) writes a valid row without the recorder having to
fabricate values.

## D2. Module layout (`src/usage/`)

```
src/usage/
  index.ts        — initUsageRecorder(): subscribes to llm:end + llm:error
  recorder.ts     — recordUsage(payload): INSERT into llm_usage_events
  query.ts        — listSubjects(windowMs), getSubjectDetail(id, windowMs)
  types.ts        — UsageEvent (write), SubjectSummary, RequestRow (read)
```

`src/db/llm-usage-events-schema.ts` holds the Drizzle table definition,
re-exported from `src/db/schema.ts`.

### D2.1 Public API

`src/usage/recorder.ts`:

```ts
export type ModelRole = 'main' | 'small' | 'embedding'

export type UsageEvent = {
  occurredAt: number // ms epoch, defaults to Date.now() when omitted
  turnId: string | null
  storageContextId: string
  contextType: 'dm' | 'group'
  chatUserId: string
  model: string
  modelRole: ModelRole
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number // 0 for embeddings
  toolCallCount: number // 0 for embeddings
  messageCount: number // 0 for embeddings, 1 for distill
  finishReason: string | null
  durationMs: number
  responseId: string | null
  error: string | null // null on success
}

export function recordUsage(event: UsageEvent): void
```

`src/usage/index.ts`:

```ts
export function initUsageRecorder(): void
```

`src/usage/query.ts`:

```ts
export type UsageWindow = { windowMs: number | null } // null = all-time

export function listSubjects(window: UsageWindow): SubjectSummary[]
export function getSubjectDetail(storageContextId: string, window: UsageWindow): RequestRow[]
```

`src/usage/types.ts`:

```ts
export type SubjectSummary = {
  storageContextId: string
  contextType: 'dm' | 'group'
  totals: {
    main: { inputTokens: number; outputTokens: number; calls: number }
    small: { inputTokens: number; outputTokens: number; calls: number }
    embedding: { inputTokens: number; outputTokens: number; calls: number }
  }
  toolCalls: number // sum of tool_call_count
  lastActiveAt: number // max occurred_at
}

export type RequestRow = {
  eventId: string
  occurredAt: number
  turnId: string | null
  chatUserId: string
  model: string
  modelRole: ModelRole
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
  finishReason: string | null
  error: string | null
}
```

`SubjectSummary.displayName` from parent §D6 lives in Phase 3 — the
recorder doesn't join to `users`/`authorized_groups`. Phase 3 resolves
the display name when building the dashboard payload.

### D2.2 Recorder internals

```ts
// src/usage/recorder.ts
export function recordUsage(event: UsageEvent): void {
  try {
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values({
        eventId: crypto.randomUUID(),
        occurredAt: event.occurredAt,
        turnId: event.turnId,
        storageContextId: event.storageContextId,
        contextType: event.contextType,
        chatUserId: event.chatUserId,
        model: event.model,
        modelRole: event.modelRole,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        stepCount: event.stepCount,
        toolCallCount: event.toolCallCount,
        messageCount: event.messageCount,
        finishReason: event.finishReason,
        durationMs: event.durationMs,
        responseId: event.responseId,
        error: event.error,
      })
      .run()
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : String(error), modelRole: event.modelRole },
      'recordUsage failed',
    )
  }
}
```

The try/catch is the safety net required by parent §D7 — failures in
the recorder must not escape into the event-bus dispatch loop, which
has no per-listener exception handling (`src/debug/event-bus.ts:29-31`).

### D2.3 Bus subscriber

```ts
// src/usage/index.ts
export function initUsageRecorder(): void {
  subscribe(handleEvent)
  log.info('usage recorder initialised')
}

function handleEvent(event: DebugEvent): void {
  if (event.type === 'llm:end') {
    recordFromLlmEnd(event)
  } else if (event.type === 'llm:error') {
    recordFromLlmError(event)
  }
}
```

`recordFromLlmEnd` and `recordFromLlmError` read the known payload
fields out of `event.data` with explicit type narrowing, build a
`UsageEvent`, and call `recordUsage`.

## D3. Emit-signature extensions

### D3.1 `emitLlmEnd`

Extend payload with two fields, plumbed through the third overload only
(the one already used in `invokeModel`):

```ts
// src/llm-orchestrator-events.ts (new payload fields shown ★)
emitUser(
  'llm:end',
  contextId,
  {
    model: mainModel,
    steps: result.steps.length,
    totalDuration: Date.now() - startTime,
    tokenUsage: result.usage,
    responseId: result.response.id,
    actualModel: result.response.modelId,
    finishReason: result.finishReason,
    messageCount: messages.length,
    chatUserId, // ★ new
    contextType, // ★ new
    ...buildToolTelemetry(tools, routing),
    generatedText: result.text,
    stepsDetail: buildStepsDetail(result.steps),
  },
  turnId,
)
```

Signature gain: `(..., chatUserId: string, contextType: 'dm' | 'group')`.
Since this function has three overloads today (no-routing, routing-only,
routing + turnId), we collapse to ONE supported shape going forward.
The other overloads are unused (`grep` confirms `invokeModel` is the
sole caller and always passes routing + turnId). Simplify to a single
typed signature.

Drop the unused overloads. `emitLlmStart` keeps its overloads because
its callsite still uses one of them (no routing path); only `emitLlmEnd`
is simplified.

### D3.2 `emitLlmError`

```ts
// src/llm-orchestrator-support.ts
export const emitLlmError = (
  contextId: string,
  chatUserId: string,
  contextType: 'dm' | 'group',
  mainModel: string,
  startTime: number,
  messageCount: number,
  error: unknown,
  turnId?: string,
): void => {
  emitUser(
    'llm:error',
    contextId,
    {
      error: error instanceof Error ? error.message : String(error),
      model: mainModel,
      chatUserId,
      contextType,
      durationMs: Date.now() - startTime,
      messageCount,
    },
    turnId,
  )
}
```

Caller (`llm-orchestrator.ts:252`) passes the values it already has.

### D3.3 `InvokeModelArgs` plumbing

`src/llm-orchestrator-types.ts:55`:

```ts
export type InvokeModelArgs = {
  contextId: string
  chatUserId: string // ★ new
  contextType: 'dm' | 'group' // ★ new
  mainModel: string
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  provider: TaskProvider
  tools: ToolSet
  toolRouting: ToolRoutingInfo | undefined
  messages: ModelMessage[]
  deps: LlmOrchestratorDeps
}
```

`llm-orchestrator.ts`'s `callLlm` already takes both; just include them
when building `InvokeModelArgs`. The current `prepareLlmInvocation`
helper (`llm-orchestrator-tools.ts`) assembles `InvokeModelArgs` —
extend it to pass `chatUserId` and `contextType` through.

For the error path: `processMessage` records the LLM start time
(implicit via the `try` block) and message count. Capture both into
locals before `try` so they're available in the `catch`:

```ts
const startedAt = Date.now()
const messageCount = baseHistory.length + 1  // + the user turn
try {
  ...
} catch (error) {
  emitLlmError(contextId, chatUserId, contextType, mainModel, startedAt, messageCount, error, resolvedTurnId)
  ...
}
```

Open question — `mainModel` at the `processMessage` level: today it's
resolved inside `callLlm` via `resolveModelName`. We can either thread
it back out for the catch or call `resolveModelName()` again in the
catch (cheap, system_config cache). Simpler: resolve once in
`processMessage` before the try, pass into `callLlm`.

## D4. Direct recorder calls (embedding + distill)

### D4.1 `src/embeddings.ts`

Widen `getEmbedding` / `tryGetEmbedding` to take a `context` parameter:

```ts
export type EmbeddingCallContext = {
  storageContextId: string
  contextType: 'dm' | 'group'
  chatUserId: string
}

export async function tryGetEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  context: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null>
```

After the `embed()` call, build a `UsageEvent` and call `recordUsage`:

```ts
const start = Date.now()
const { embedding, usage } = await deps.embed({ model: provider.embeddingModel(model), value: text })
recordUsage({
  occurredAt: start,
  turnId: null,
  storageContextId: context.storageContextId,
  contextType: context.contextType,
  chatUserId: context.chatUserId,
  model,
  modelRole: 'embedding',
  inputTokens: usage?.tokens ?? null, // single-value embed returns tokens count
  outputTokens: null, // embeddings have no output tokens
  stepCount: 0,
  toolCallCount: 0,
  messageCount: 0,
  finishReason: null,
  durationMs: Date.now() - start,
  responseId: null,
  error: null,
})
```

Failure path inside `tryGetEmbedding` — record an error row too:

```ts
try { ... } catch (error) {
  recordUsage({ ...sameShape, error: error.message, durationMs: Date.now() - start })
}
```

Note on `usage` shape: `embed()` from the Vercel AI SDK returns
`{ embedding, usage: { tokens: number } | undefined }`. We map `tokens`
to `input_tokens`; `output_tokens` stays null for embeddings.

Callsite updates:

- `src/tools/save-memo.ts:38` — pass
  `{ storageContextId: userId, contextType: <dm | group>, chatUserId: <author> }`.
  Need to look up what `userId` represents in the save-memo context;
  the brainstorm noted memos are per-user even in groups, so:
  - `storageContextId: userId` (the memo's owner)
  - `contextType: 'dm'` (memos are per-user; even in group chats, the
    save_memo tool is called against the user's own memos)
  - `chatUserId: userId`
- `src/tools/search-memos.ts:95` — same.

The tool factories don't currently receive `contextType` explicitly, but
they do receive `MakeToolsOptions` which includes it
(`src/tools/CLAUDE.md`). Thread it through.

### D4.2 `src/web/distill.ts`

Same pattern — widen `distillWebContent` input to require
`chatUserId` and `contextType` (it already takes `storageContextId`):

```ts
export async function distillWebContent(
  input: {
    readonly storageContextId: string
    readonly contextType: 'dm' | 'group' // ★ new
    readonly chatUserId: string // ★ new
    readonly title: string
    readonly content: string
    readonly goal?: string
  },
  deps: DistillDeps = defaultDeps,
): Promise<DistilledContent>
```

After `generateText` returns, build a UsageEvent and call `recordUsage`
with `modelRole: 'small'`, `messageCount: 1` (the prompt is a single
synthetic message), `stepCount: result.steps?.length ?? 1`,
`toolCallCount: 0`.

Callsite: `src/web/fetch.ts` (or wherever `distillWebContent` is
called). Find and update.

## D5. `initUsageRecorder` wiring

`src/index.ts`, between `seedSystemConfigFromEnv()` (line 74) and
`initializeMessageCache()` (line 83):

```ts
seedSystemConfigFromEnv()
const missingSystemKeys = missingSystemConfigKeys()
if (missingSystemKeys.length > 0) {
  log.warn(...)
}

initUsageRecorder()    // ★ new

initializeMessageCache()
```

`initUsageRecorder` must run BEFORE the chat provider starts and before
any other event subscriber wires in. The subscriber being present makes
`listeners.size >= 1` permanently, so `emitUser` no longer
short-circuits — but that's fine: the expensive payload-build work
inside `emitLlmEnd` already runs regardless of listener count (it's
upstream of the bus dispatch).

No teardown: the recorder lives for the process lifetime; the graceful
shutdown path doesn't need to call into the recorder.

## D6. Drizzle schema

`src/db/llm-usage-events-schema.ts`:

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const llmUsageEvents = sqliteTable(
  'llm_usage_events',
  {
    eventId: text('event_id').primaryKey(),
    occurredAt: integer('occurred_at').notNull(),
    turnId: text('turn_id'),
    storageContextId: text('storage_context_id').notNull(),
    contextType: text('context_type').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    model: text('model').notNull(),
    modelRole: text('model_role').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    stepCount: integer('step_count').notNull().default(0),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    finishReason: text('finish_reason'),
    durationMs: integer('duration_ms').notNull(),
    responseId: text('response_id'),
    error: text('error'),
  },
  (table) => [
    index('idx_llm_usage_subject').on(table.storageContextId, table.occurredAt),
    index('idx_llm_usage_chat_user').on(table.chatUserId, table.occurredAt),
    index('idx_llm_usage_turn').on(table.turnId),
    index('idx_llm_usage_occurred').on(table.occurredAt),
  ],
)

export type LlmUsageEventRow = typeof llmUsageEvents.$inferSelect
```

`src/db/schema.ts` gets:

```ts
export { llmUsageEvents } from './llm-usage-events-schema.js'
export type { LlmUsageEventRow } from './llm-usage-events-schema.js'
```

## D7. Migration 035

`src/db/migrations/035_llm_usage_events.ts`, plain SQL matching the
shape of `034_system_config.ts`:

```ts
const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_usage_events (
      event_id           TEXT PRIMARY KEY,
      occurred_at        INTEGER NOT NULL,
      turn_id            TEXT,
      storage_context_id TEXT NOT NULL,
      context_type       TEXT NOT NULL,
      chat_user_id       TEXT NOT NULL,
      model              TEXT NOT NULL,
      model_role         TEXT NOT NULL,
      input_tokens       INTEGER,
      output_tokens      INTEGER,
      step_count         INTEGER NOT NULL DEFAULT 0,
      tool_call_count    INTEGER NOT NULL DEFAULT 0,
      message_count      INTEGER NOT NULL DEFAULT 0,
      finish_reason      TEXT,
      duration_ms        INTEGER NOT NULL,
      response_id        TEXT,
      error              TEXT
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_subject   ON llm_usage_events(storage_context_id, occurred_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_chat_user ON llm_usage_events(chat_user_id, occurred_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_turn      ON llm_usage_events(turn_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_occurred  ON llm_usage_events(occurred_at)`)
  log.info('migration 035: created llm_usage_events table + indexes')
}
```

Registered in `src/db/index.ts` between `migration034SystemConfig` and
`migration036DropUserLlmConfig`. The numeric ordering is preserved
(034 → 035 → 036) even though Phase 1 shipped only 034 + 036; the new
035 slots in cleanly.

Idempotent (`IF NOT EXISTS` on table and indexes), so re-running on an
already-migrated DB is a no-op.

## D8. Query module

`src/usage/query.ts`:

```ts
export function listSubjects(window: UsageWindow): SubjectSummary[] {
  const since = window.windowMs === null ? 0 : Date.now() - window.windowMs

  // Aggregate per (storage_context_id, model_role)
  const rows = getDrizzleDb()
    .select({
      storageContextId: llmUsageEvents.storageContextId,
      contextType: llmUsageEvents.contextType,
      modelRole: llmUsageEvents.modelRole,
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`,
      toolCalls: sql<number>`coalesce(sum(${llmUsageEvents.toolCallCount}), 0)`,
      lastActiveAt: sql<number>`max(${llmUsageEvents.occurredAt})`,
    })
    .from(llmUsageEvents)
    .where(gte(llmUsageEvents.occurredAt, since))
    .groupBy(llmUsageEvents.storageContextId, llmUsageEvents.contextType, llmUsageEvents.modelRole)
    .all()

  // Pivot model_role into the three columns of SubjectSummary
  return pivotByRole(rows)
}

export function getSubjectDetail(storageContextId: string, window: UsageWindow): RequestRow[] {
  const since = window.windowMs === null ? 0 : Date.now() - window.windowMs
  return getDrizzleDb()
    .select({
      /* RequestRow columns */
    })
    .from(llmUsageEvents)
    .where(and(eq(llmUsageEvents.storageContextId, storageContextId), gte(llmUsageEvents.occurredAt, since)))
    .orderBy(desc(llmUsageEvents.occurredAt))
    .all()
}
```

`pivotByRole` is a small in-memory transform: group rows by
`storageContextId`, fold each `modelRole`'s aggregates into the right
slot of `SubjectSummary.totals`, fill missing roles with zeros.

## D9. Failure handling

Per parent §D7 and brainstorm Q (E), the recorder catches and logs all
exceptions. The DB constraint check (`event_id` is PK with
`crypto.randomUUID()`) means collisions are astronomically rare in
practice; a collision still produces a single logged `error` line and
the next event proceeds normally.

The recorder does NOT:

- rethrow
- retry on transient errors (SQLite write contention with WAL is not a
  real concern at this volume)
- maintain in-memory buffering or batching (single-row inserts are
  cheap; the bus is in-process)

If `getDrizzleDb()` somehow returns a closed connection (test harness
edge case), the catch absorbs the error.

## D10. Logging

- Recorder logs `info` on `initUsageRecorder` (once per process).
- `error` on insert failure with `eventType` and exception message.
- `debug` (optional) inside `recordUsage` with the modelRole and
  contextId for hot-path tracing; can be filtered out via `LOG_LEVEL`.

Per parent §D7, the recorder NEVER logs:

- `apiKey` content
- `generatedText` content (it's in the bus payload but we don't persist
  it)
- raw token contents

## D11. Forward-compatibility checks (carry-through from brainstorm)

| Future                  | This-phase shape                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Phase 3 dashboard       | Query module already returns the design D6 shapes; routes just wire them                                              |
| Phase 4 tool-call table | Mirror this module pattern; the `tool_call_count` field stays as a fast aggregate                                     |
| Phase 4 outbox columns  | `ALTER TABLE ADD COLUMN forwarded_at INTEGER`, no schema migration required for the existing rows                     |
| Phase 5 anonymous stats | Reads `occurred_at`, `storage_context_id`, `chat_user_id` for active-subject counts; indexes already there            |
| Deterministic event_id  | Phase 4 swap is local: change `crypto.randomUUID()` to a hash of `(response_id, occurred_at, model_role)` and migrate |

## D12. Out of scope

- HTTP routes / dashboard UI (parent §D6 → Phase 3).
- DM `/admin` command (parent §D4 → Phase 3 or never).
- Tool-call per-row table (Phase 4).
- Outbox forwarder (Phase 4).
- Per-tool drill-down beyond the per-turn count.
- Daily roll-ups; raw query at this volume is fine.
- Charts in the dashboard; tables only in Phase 3.

## D13. Code-change file list

| File                                               | Change                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/db/migrations/035_llm_usage_events.ts`        | New: create table + 4 indexes                                                                          |
| `src/db/index.ts:48-119`                           | Register `migration035LlmUsageEvents` between 034 and 036                                              |
| `src/db/llm-usage-events-schema.ts`                | New: Drizzle table                                                                                     |
| `src/db/schema.ts:28`                              | Re-export `llmUsageEvents` and `LlmUsageEventRow`                                                      |
| `src/usage/recorder.ts`                            | New: `recordUsage`, `UsageEvent` type                                                                  |
| `src/usage/index.ts`                               | New: `initUsageRecorder`, bus subscriber                                                               |
| `src/usage/query.ts`                               | New: `listSubjects`, `getSubjectDetail`                                                                |
| `src/usage/types.ts`                               | New: `SubjectSummary`, `RequestRow`, `ModelRole`, `UsageWindow`                                        |
| `src/index.ts:74-83`                               | Call `initUsageRecorder()` after `seedSystemConfigFromEnv`                                             |
| `src/llm-orchestrator-events.ts:153-202`           | Extend `emitLlmEnd` payload with `chatUserId`, `contextType`; simplify to single signature             |
| `src/llm-orchestrator-support.ts:161-181`          | Extend `emitLlmError` with `chatUserId`, `contextType`, `mainModel`, `startTime`, `messageCount`       |
| `src/llm-orchestrator-types.ts:55`                 | Add `chatUserId`, `contextType` to `InvokeModelArgs`                                                   |
| `src/llm-orchestrator-invoke.ts:97,108`            | Pass new fields through to emit calls                                                                  |
| `src/llm-orchestrator-tools.ts`                    | If `prepareLlmInvocation` builds `InvokeModelArgs`, thread the new fields                              |
| `src/llm-orchestrator.ts:217-256`                  | Capture `startedAt`/`messageCount`/`mainModel` before try, pass to `emitLlmError`; thread to `callLlm` |
| `src/embeddings.ts:33-63`                          | Add `EmbeddingCallContext` parameter; call `recordUsage` after embed (success and failure)             |
| `src/tools/save-memo.ts:38`                        | Pass embedding context to `tryGetEmbedding`                                                            |
| `src/tools/search-memos.ts:95`                     | Same                                                                                                   |
| `src/web/distill.ts:96-128`                        | Accept `chatUserId`, `contextType` in input; call `recordUsage` after `generateText`                   |
| `src/web/fetch.ts` (or wherever distill is called) | Thread the new fields through                                                                          |

Tests (under `tests/`):

| Test file                                          | Coverage                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tests/db/migrations/035-llm-usage-events.test.ts` | Table + 4 indexes; NOT NULL; default 0 on counts; idempotency                    |
| `tests/usage/recorder.test.ts`                     | Round-trip insert; failure path logs but doesn't throw; null tokens accepted     |
| `tests/usage/recorder-integration.test.ts`         | `llm:end` event in → row out; `llm:error` event in → row out with error set      |
| `tests/usage/query.test.ts`                        | `listSubjects` aggregates correctly across model roles + windows; pivot logic    |
| `tests/llm-orchestrator-events.test.ts`            | Extended payload contains chatUserId/contextType; existing assertions still pass |
| `tests/llm-orchestrator-support.test.ts`           | `emitLlmError` extended payload                                                  |
| `tests/embeddings.test.ts`                         | `tryGetEmbedding` records on success + failure                                   |
| `tests/web/distill.test.ts`                        | `distillWebContent` records on success + failure                                 |
| `tests/llm-orchestrator.test.ts`                   | `emitLlmError` is called with the captured fields on the throw path              |

## D14. Acceptance (from roadmap, refined)

- After a real LLM turn, one row appears in `llm_usage_events` with
  populated `model`, `model_role='main'`, `turn_id`, `storage_context_id`,
  `chat_user_id`, `context_type`, `step_count >= 1`,
  `tool_call_count >= 0`, `message_count >= 1`, `duration_ms > 0`.
- After a save_memo with embedding model configured, one row with
  `model_role='embedding'` and `input_tokens` populated if the provider
  returned usage.
- After a web_fetch that triggers distillation, one row with
  `model_role='small'`.
- A thrown `generateText` (mocked in a test) still produces one row with
  `error` populated and `model_role='main'`.
- A recorder exception (mocked) is logged and dropped; the
  `state-collector` subscriber continues to fire.
- `listSubjects({ windowMs: 7 * 24 * 3600 * 1000 })` returns rows whose
  totals sum equals the raw-SQL aggregate over the same window.

## D15. Rollback

- Revert the orchestrator and module changes (no public API surfaces
  shipped beyond `src/usage/` and the bus payload extension; both are
  internal).
- The migration is additive — leaving `llm_usage_events` in place is
  harmless if the recorder is removed.
- For a clean rollback: drop migration 035's registration in
  `src/db/index.ts`; the table stays in deployed DBs but no longer
  receives writes. Optional `DROP TABLE llm_usage_events` in a follow-up
  migration if storage matters.
