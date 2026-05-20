# Phase 4 — Tool-Call Rows + Idempotency Hardening — Implementation Plan

**Date:** 2026-05-20
**Status:** Draft
**Branch:** `claude/phase-4-llm-billing-hntTD`
**Per-phase design:** [`../specs/2026-05-20-phase-4-tool-call-rows-design.md`](../specs/2026-05-20-phase-4-tool-call-rows-design.md)
**Brainstorm:** [`../notes/2026-05-20-phase-4-tool-call-rows-brainstorm.md`](../notes/2026-05-20-phase-4-tool-call-rows-brainstorm.md)
**Parent roadmap:** [`2026-05-19-central-llm-billing-roadmap.md`](2026-05-19-central-llm-billing-roadmap.md)

## Sequencing principle

The TDD hook gates every `src/` and `client/` edit on a failing test.
Each step splits into:

- **T**: write the failing test(s).
- **I**: write implementation that turns the test(s) green.
- **R**: refactor only when there's something to refactor.

Steps are ordered so each leaves the tree green between steps. Within a
step the tree may be red, but never between steps.

Test-first applies to both `src/` and `client/` implementation files.
Markdown / config / migration edits do not trigger the gate, but
migration files DO live in `src/db/migrations/` and they're tested
against in-memory DBs (see Phase 2's `035_llm_usage_events.test.ts`).

## Step 0 — Pre-flight

- Confirm we are on branch `claude/phase-4-llm-billing-hntTD`.
- `bun test` passes on the baseline.
- `bun typecheck` passes.
- Phase 2's `src/usage/recorder.ts`, `src/usage/index.ts`, and
  `src/usage/query.ts` all exist (verified during code-surface
  survey).
- Highest existing migration is `036_drop_user_llm_config.ts`. Next
  numbers are `037` and `038`.
- Knip baseline: `bun knip` passes.

## Step 1 — Migration 037 (new `tool_call_events` table)

**T**: add `tests/db/migrations/037-tool-call-events.test.ts`:

- Run the migration chain through 037 against `new Database(':memory:')`.
- Assert table `tool_call_events` exists.
- Assert columns exist with expected types and nullability via
  `PRAGMA table_info(tool_call_events)`.
- Assert primary key is `event_id`.
- Assert `forward_attempts` default is `0`.
- Assert indexes exist:
  - `idx_tool_call_subject`
  - `idx_tool_call_chat_user`
  - `idx_tool_call_turn`
  - `idx_tool_call_tool`
  - `idx_tool_call_outbox`
- Assert `idx_tool_call_outbox` is a partial index `WHERE forwarded_at IS NULL`
  (via `sqlite_master.sql`).

**I**: create `src/db/migrations/037_tool_call_events.ts` modeled on
`035_llm_usage_events.ts`. Plain `db.run(SQL)` calls. Single
`CREATE TABLE tool_call_events (...)` statement, then five
`CREATE INDEX ...` statements (the last partial). Register the
migration in the chain runner (mirror the pattern Phase 2 / Phase 3
added).

Migration file shape:

```ts
import type { Database } from 'bun:sqlite'

export const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_call_events (
      event_id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      storage_context_id TEXT NOT NULL,
      context_type TEXT NOT NULL,
      chat_user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      model_role TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      duration_ms INTEGER,
      error_type TEXT,
      error_code TEXT,
      retryable INTEGER,
      recovered INTEGER,
      args_bytes INTEGER,
      result_bytes INTEGER,
      response_id TEXT,
      forwarded_at INTEGER,
      forward_attempts INTEGER NOT NULL DEFAULT 0,
      forward_error TEXT
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_call_subject ON tool_call_events (storage_context_id, occurred_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_call_chat_user ON tool_call_events (chat_user_id, occurred_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_call_turn ON tool_call_events (turn_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_call_tool ON tool_call_events (tool_name, occurred_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tool_call_outbox ON tool_call_events (occurred_at) WHERE forwarded_at IS NULL`)
}
```

**Verify**: `bun test tests/db/migrations/037-tool-call-events.test.ts`.

## Step 2 — Migration 038 (outbox columns on `llm_usage_events`)

**T**: add `tests/db/migrations/038-llm-usage-outbox.test.ts`:

- Run the chain through 038.
- Assert columns `forwarded_at`, `forward_attempts`, `forward_error`
  exist on `llm_usage_events` with expected types/defaults via
  `PRAGMA table_info`.
- Assert partial index `idx_llm_usage_outbox` exists with the
  `WHERE forwarded_at IS NULL` clause.
- Assert a row inserted before the migration (via a synthetic 035-only
  setup) gets `forward_attempts = 0` after the ALTER (SQLite fills
  the default).

**I**: create `src/db/migrations/038_llm_usage_events_outbox.ts`:

```ts
export const up = (db: Database): void => {
  db.run(`ALTER TABLE llm_usage_events ADD COLUMN forwarded_at INTEGER`)
  db.run(`ALTER TABLE llm_usage_events ADD COLUMN forward_attempts INTEGER NOT NULL DEFAULT 0`)
  db.run(`ALTER TABLE llm_usage_events ADD COLUMN forward_error TEXT`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_llm_usage_outbox ON llm_usage_events (occurred_at) WHERE forwarded_at IS NULL`)
}
```

Register in the chain runner.

**Verify**: `bun test tests/db/migrations/038-llm-usage-outbox.test.ts`.

## Step 3 — Drizzle schemas

**T**: extend `tests/db/schema.test.ts` (or its nearest neighbor) to
round-trip: insert a synthetic row into `tool_call_events` via the new
Drizzle schema and select it back. Mirror the existing pattern for
`llm_usage_events` round-trip.

**I (a)**: create `src/db/tool-call-events-schema.ts`:

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const toolCallEvents = sqliteTable('tool_call_events', {
  eventId: text('event_id').primaryKey(),
  turnId: text('turn_id').notNull(),
  occurredAt: integer('occurred_at').notNull(),
  storageContextId: text('storage_context_id').notNull(),
  contextType: text('context_type').notNull(),
  chatUserId: text('chat_user_id').notNull(),
  model: text('model').notNull(),
  modelRole: text('model_role').notNull(),
  toolName: text('tool_name').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  success: integer('success').notNull(),
  durationMs: integer('duration_ms'),
  errorType: text('error_type'),
  errorCode: text('error_code'),
  retryable: integer('retryable'),
  recovered: integer('recovered'),
  argsBytes: integer('args_bytes'),
  resultBytes: integer('result_bytes'),
  responseId: text('response_id'),
  forwardedAt: integer('forwarded_at'),
  forwardAttempts: integer('forward_attempts').notNull().default(0),
  forwardError: text('forward_error'),
}, (table) => ({
  subjectIdx: index('idx_tool_call_subject').on(table.storageContextId, table.occurredAt),
  chatUserIdx: index('idx_tool_call_chat_user').on(table.chatUserId, table.occurredAt),
  turnIdx: index('idx_tool_call_turn').on(table.turnId),
  toolIdx: index('idx_tool_call_tool').on(table.toolName, table.occurredAt),
}))
```

(The partial outbox index is migration-only; Drizzle doesn't model
partial-index predicates today. Tests assert it via raw SQL.)

**I (b)**: extend `src/db/llm-usage-events-schema.ts` with the three
new columns:

```ts
forwardedAt: integer('forwarded_at'),
forwardAttempts: integer('forward_attempts').notNull().default(0),
forwardError: text('forward_error'),
```

**I (c)**: re-export `toolCallEvents` from `src/db/schema.ts`.

**Verify**: `bun typecheck && bun test tests/db/schema.test.ts`.

## Step 4 — Deterministic event-id helper

**T**: add `tests/usage/event-id.test.ts`:

- `toolCallEventId('turn-abc', 'call-1')` returns a 64-char hex string.
- Stable: same inputs → same output across calls.
- Different `turnId` or `toolCallId` → different output.
- `usageEventId('turn-abc', 'resp-1', 'main')` returns 64-char hex,
  stable, distinct from `usageEventId('turn-abc', 'resp-1', 'small')`.
- `usageEventId(null, 'resp-1', 'main')` and
  `usageEventId('turn-abc', null, 'main')` both return stable
  64-char hex.
- `usageEventId(null, null, 'main')` — the helper does NOT throw; the
  caller (recorder) is responsible for rejecting this case.

**I**: create `src/usage/event-id.ts`:

```ts
import { createHash } from 'node:crypto'

export const toolCallEventId = (turnId: string, toolCallId: string): string => {
  return createHash('sha256').update(`${turnId}|${toolCallId}`).digest('hex')
}

export const usageEventId = (turnId: string | null, responseId: string | null, modelRole: string): string => {
  return createHash('sha256').update(`${turnId ?? ''}|${responseId ?? ''}|${modelRole}`).digest('hex')
}
```

**Verify**: `bun test tests/usage/event-id.test.ts && bun typecheck`.

## Step 5 — Switch `recorder.ts` to deterministic id

**T**: extend `tests/usage/recorder.test.ts`:

- Calling `recordUsage()` twice with the same `(turnId, responseId,
  modelRole)` triggers a PK collision; the recorder logs `warn` and
  does not crash.
- Two distinct calls produce distinct rows.
- When `turnId` and `responseId` are BOTH null, `recordUsage()` logs
  `warn`, does NOT insert, and returns.

**I**: in `src/usage/recorder.ts`, replace `crypto.randomUUID()` with
`usageEventId(payload.turnId, payload.responseId, payload.modelRole)`.
Wrap the INSERT in a try/catch that classifies SQLITE constraint
violations and logs at `warn`; other errors keep their current
`error`-level log. Add the null-input guard at the top.

**R**: extract the constraint-classifier into a small helper if
`tool-call-recorder.ts` will need the same shape (preview — it will).

**Verify**: `bun test tests/usage/recorder.test.ts`.

## Step 6 — Extend event payloads in `llm-orchestrator-invoke.ts`

**T**: add `tests/llm-orchestrator-invoke.test.ts` cases (or extend
existing ones):

- Stub the event bus, fire a tool-call lifecycle, assert
  `tool:execute_end` event data contains `chatUserId`, `contextType`,
  `model`, `modelRole`, `responseId`, `argsBytes`, `resultBytes`.
- `tool:failure_classified` data contains `chatUserId`, `contextType`,
  `model`, `modelRole`.
- `argsBytes` matches `Buffer.byteLength(JSON.stringify(args), 'utf8')`.
- `resultBytes` is null when the tool failed; numeric when it
  succeeded.
- No `args` or `result` content appears in either event payload
  (assertion: serialize `event.data` to JSON, scan for a known
  fixture-arg substring, expect not found).

**I**: edit `src/llm-orchestrator-invoke.ts`:

- Thread `chatUserId`, `contextType`, `model`, `modelRole`,
  `responseId` into `buildToolCallStartHandler`,
  `buildToolCallFinishHandler`, and `emitFailureClassified` via
  closure parameters from `invokeModel`.
- Compute `argsBytes` at `buildToolCallStartHandler` time:
  `argsBytes: Buffer.byteLength(JSON.stringify(input ?? null), 'utf8')`.
  Stash on the per-call buffer keyed by `toolCallId`.
- At `buildToolCallFinishHandler`, compute `resultBytes` for success
  results; emit both `argsBytes` (carried from the start) and
  `resultBytes`.
- `responseId` is captured from the final `result.response.id` once
  per turn — but tool calls fire BEFORE the response id is known. So
  the recorder will see `null` `responseId` on the live event. The
  recorder uses `turnId + toolCallId` for `event_id`, so `responseId`
  on tool-call rows is informational only. Field exists, may be null.

  Actually re-read this: response id is per-turn (LLM response) and
  the same for all tool calls in that turn. The orchestrator does
  know it AFTER the final `generateText` resolves, NOT during
  individual tool finishes. So per-call rows get null `responseId`
  unless we backfill at `llm:end` time. **Decision:** leave
  `response_id` null on tool-call rows in v1. Don't add a backfill
  pass. Note in the table doc.

  Update the design accordingly (see follow-up note at bottom of
  this plan).

**R**: factor a `buildToolCallContext()` helper that bundles
`{chatUserId, contextType, model, modelRole}` once per invoke and
closes over both handlers, to keep both emit sites readable.

**Verify**: `bun test tests/llm-orchestrator-invoke.test.ts &&
bun test tests/llm-orchestrator.test.ts`.

## Step 7 — `src/usage/tool-call-recorder.ts`

**T**: add `tests/usage/tool-call-recorder.test.ts`:

- `recordToolCall(event)` inserts a `tool_call_events` row with the
  expected columns; `event_id` matches `toolCallEventId(turnId,
  toolCallId)`.
- Idempotent: second insert with the same payload triggers PK
  conflict, recorder logs `warn`, returns without throwing.
- `updateToolCallClassification(turnId, toolCallId, classifier)`
  updates `error_type`, `error_code`, `retryable`, `recovered` for
  the matching row.
- When no matching row exists yet, the update buffers for ~100ms
  (fake-timer test), retries once, and on failure logs `warn`.
- A successful call (`success=1`) followed by a classifier update
  (which shouldn't happen in practice) is ignored — the recorder
  only updates rows where `success=0`. Actually: design D5 says
  "UPDATE the row by event_id" unconditionally; the success-path
  classifier event won't fire anyway. Keep the update unconditional
  for simplicity; tests assert classifier-on-success-row updates
  fields (no-op-in-spirit, but exercised).

**I**: create `src/usage/tool-call-recorder.ts`:

```ts
import { eq } from 'drizzle-orm'
import { getDrizzleDb } from '../db/index.js'
import { toolCallEvents } from '../db/tool-call-events-schema.js'
import { toolCallEventId } from './event-id.js'
import { log } from '../log.js' // use whatever the repo uses
import type { ToolCallEvent, ToolCallClassification } from './types.js'

const PENDING_UPDATE_RETRY_MS = 100

export const recordToolCall = (event: ToolCallEvent): void => {
  const eventId = toolCallEventId(event.turnId, event.toolCallId)
  try {
    getDrizzleDb().insert(toolCallEvents).values({
      eventId,
      turnId: event.turnId,
      occurredAt: event.occurredAt,
      storageContextId: event.storageContextId,
      contextType: event.contextType,
      chatUserId: event.chatUserId,
      model: event.model,
      modelRole: event.modelRole,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      success: event.success ? 1 : 0,
      durationMs: event.durationMs,
      argsBytes: event.argsBytes,
      resultBytes: event.resultBytes,
      responseId: event.responseId,
    }).run()
  } catch (error) {
    handleRecorderInsertError(error, { table: 'tool_call_events', eventId })
  }
}

export const updateToolCallClassification = (turnId: string, toolCallId: string, classification: ToolCallClassification): void => {
  const eventId = toolCallEventId(turnId, toolCallId)
  const db = getDrizzleDb()
  const result = db.update(toolCallEvents).set({
    errorType: classification.errorType,
    errorCode: classification.errorCode,
    retryable: classification.retryable === null ? null : classification.retryable ? 1 : 0,
    recovered: classification.recovered === null ? null : classification.recovered ? 1 : 0,
  }).where(eq(toolCallEvents.eventId, eventId)).run()
  if (result.changes === 0) {
    setTimeout(() => {
      const retry = db.update(toolCallEvents).set({
        errorType: classification.errorType,
        errorCode: classification.errorCode,
        retryable: classification.retryable === null ? null : classification.retryable ? 1 : 0,
        recovered: classification.recovered === null ? null : classification.recovered ? 1 : 0,
      }).where(eq(toolCallEvents.eventId, eventId)).run()
      if (retry.changes === 0) {
        log.warn({ turnId, toolCallId, eventId }, 'tool-call classification: row not found after retry')
      }
    }, PENDING_UPDATE_RETRY_MS)
  }
}
```

`handleRecorderInsertError` is extracted from Step 5's classifier
helper.

**R**: extract the classification-to-row mapping (boolean → 0/1)
into a small helper if the same shape appears in queries.

**Verify**: `bun test tests/usage/tool-call-recorder.test.ts`.

## Step 8 — Extend types

**T**: extend `tests/usage/types.test.ts` (or add it if it doesn't
exist):

- `ToolCallEvent` shape is correctly typed (compile-only assertion).
- `ToolCallRow` shape carries everything from the row plus boolean
  `success` (not 0/1).

**I**: edit `src/usage/types.ts`:

```ts
export interface ToolCallEvent {
  turnId: string
  occurredAt: number
  storageContextId: string
  contextType: 'dm' | 'group'
  chatUserId: string
  model: string
  modelRole: 'main' | 'small'
  toolName: string
  toolCallId: string
  success: boolean
  durationMs: number | null
  argsBytes: number | null
  resultBytes: number | null
  responseId: string | null
}

export interface ToolCallClassification {
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
}

export interface ToolCallRow extends ToolCallEvent {
  eventId: string
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
}

export interface ToolCallSubjectSummary {
  storageContextId: string
  contextType: 'dm' | 'group'
  totalCalls: number
  successCalls: number
  failureCalls: number
  argsBytesTotal: number
  resultBytesTotal: number
  durationMsTotal: number
}
```

**Verify**: `bun typecheck`.

## Step 9 — Wire subscriber dispatch

**T**: extend `tests/usage/index.test.ts`:

- `initUsageRecorder()` registers a single listener.
- Listener dispatches `tool:execute_end` to `recordToolCall()`.
- Listener dispatches `tool:failure_classified` to
  `updateToolCallClassification()`.
- Listener still dispatches `llm:end` / `llm:error` to
  `recordUsage()` (regression).
- Unknown event types are ignored.

**I**: edit `src/usage/index.ts` to add the new event-type
branches in the existing `handleEvent` switch (or equivalent
dispatch). Map event data into `ToolCallEvent` and
`ToolCallClassification` shapes.

Buffer scenario from design D4 (classifier UPDATE retries): the
`setTimeout` lives inside `updateToolCallClassification`, not in the
subscriber. Subscriber stays synchronous.

**Verify**: `bun test tests/usage/index.test.ts`.

## Step 10 — Read helpers in `src/usage/query.ts`

**T**: extend `tests/usage/query.test.ts`:

- Seed N rows into `tool_call_events` (mix of subjects, success and
  failure, varying byte sizes and durations).
- `listToolCallsForTurn(turnId)` returns only rows for that turn,
  ordered by `occurred_at`.
- `summarizeToolCallsBySubject(windowMs)` returns aggregates;
  totals match hand-rolled SQL `SELECT COUNT(*), SUM(args_bytes),
  ...`.
- `summarizeToolCallsBySubject(null)` returns all-time aggregates.
- Empty table → both helpers return `[]`.

**I**: add the two read helpers to `src/usage/query.ts`. Use
Drizzle's `select / groupBy / sum` builders.

**Verify**: `bun test tests/usage/query.test.ts`.

## Step 11 — Knip ignore for new exports

**T**: `bun knip` should be clean. Either of:

- The new helpers are referenced from a future Phase-3-style
  consumer module (we don't ship one this phase).
- Or we add knip ignores.

**I**: add knip ignores using the existing pattern
(`c0e8960`: "ignore .svelte-only exports in client/debug/billing"):

In `src/usage/query.ts`, mark `listToolCallsForTurn` and
`summarizeToolCallsBySubject` with a comment such as
`// knip-ignore -- Phase-4-pending dashboard wiring` or extend
`knip.json` exclusions, whichever the repo uses today.

**Verify**: `bun knip`.

## Step 12 — Documentation updates

(Markdown only — no TDD gate.)

- Update `CLAUDE.md`:
  - Architecture section: list `tool_call_events` next to
    `llm_usage_events`.
  - Phase 4 status notes if there's a phase-tracking section.
- Update `src/db/migrations/CLAUDE.md` (if it exists) with entries
  for 037 and 038.

**Verify**: `bun format:check && bun lint` (markdown lint catches the
common slip-ups).

## Step 13 — Full verification gate

Run the curated checks:

```bash
bun typecheck
bun lint
bun format:check
bun test
bun knip
bun security
```

Resolve anything that surfaces. Common likely items:

- `bun security` flags around hashing (it should not — `createHash` is
  not user-input-sensitive here).
- `bun knip` complains about new exports (Step 11 handles this).

## Step 14 — Manual smoke

(Local; not part of CI.)

1. `bun start` against a fresh test DB with valid `LLM_API_KEY` env.
2. Send a DM that triggers `create_task` (e.g. "make a task to test
   tool-call rows").
3. `sqlite3 papai.db "SELECT * FROM tool_call_events ORDER BY occurred_at DESC LIMIT 5"`
   — assert one row exists with `success=1` and populated
   `args_bytes` / `result_bytes`.
4. Send a DM that triggers a known-failing tool (e.g. one with
   missing required field). Assert a `success=0` row appears, then
   (~10ms later) `error_type` / `error_code` are populated.
5. Bounce the bot and resend the same message; assert no PK conflict
   error in logs (deterministic id) and a NEW row appears (new
   turn_id and tool_call_id).

## Step 15 — Commit grouping

Group commits by logical chunk so review is parseable:

1. `chore(billing): migration 037 - tool_call_events table`
2. `chore(billing): migration 038 - outbox columns on llm_usage_events`
3. `feat(billing): Drizzle schema for tool_call_events + extended llm_usage_events`
4. `feat(billing): deterministic event_id helpers`
5. `refactor(billing): switch usage recorder to deterministic event_id`
6. `feat(orchestrator): extend tool lifecycle event payloads`
7. `feat(billing): tool-call recorder (INSERT + UPDATE)`
8. `feat(billing): tool-call query helpers`
9. `chore(billing): knip ignore for Phase-4-pending query exports`
10. `docs(billing): Phase 4 architecture notes`

The brainstorm + design + plan docs are landed as a single docs
commit ahead of this implementation chain, matching Phase 2 / Phase 3
practice.

## Rollback strategy

If any step fails after merge:

- Migrations 037/038 can be reverted with a forward migration that
  drops the table / removes the columns. Phase 4 ships before any
  external consumer reads from the new schema, so reverting is safe.
- Event payload extensions are additive; reverting them removes
  fields the recorder needs and the recorder writes null. Safe.
- The recorder's deterministic `event_id` switch can be reverted to
  `crypto.randomUUID()` without losing any data — existing rows have
  whatever id they were inserted with.

## Open follow-ups noted during planning

1. **`response_id` on tool-call rows is null in v1.** Captured during
   Step 6: `result.response.id` is only known at the end of the LLM
   turn, AFTER tool finishes have already emitted. Backfilling
   tool-call rows at `llm:end` time is a separate enhancement; not
   blocking. Update the per-phase design to reflect this clearly (it
   already lists `response_id` as nullable, but Step 6 reveals it
   will be null by default).
2. **Knip exclusion mechanism.** Step 11 picks whichever approach the
   repo currently uses; the `c0e8960` commit uses a code comment.
   Confirm at implementation time.
3. **Partial-index portability.** SQLite supports `WHERE` on
   `CREATE INDEX` since 3.8 (2013). Bun's bundled SQLite is far
   newer; not a concern in practice. If a downstream environment
   rejects it, fall back to a full index in a follow-up migration.
4. **Phase 5 alignment.** The bytes-only contract for `args` /
   `result` already aligns with Phase 5's anonymity envelope, so no
   coordination work is needed.
