# Phase 4 — Tool-Call Rows + Idempotency Hardening — Design Refinement

**Date:** 2026-05-20
**Status:** Draft, refining parent spec for Phase 4 scope
**Parent design:** [`2026-05-19-central-llm-billing-design.md`](./2026-05-19-central-llm-billing-design.md)
**Roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Brainstorm:** [`../notes/2026-05-20-phase-4-tool-call-rows-brainstorm.md`](../notes/2026-05-20-phase-4-tool-call-rows-brainstorm.md)
**Branch:** `claude/phase-4-llm-billing-hntTD`

## Purpose of this document

The parent design covers all five phases at a high level. This file
narrows its decisions to Phase 4 and lifts the brainstorm's
resolutions. Where this file and the parent disagree, this file wins
for Phase 4 only.

## Phase 4 in one paragraph

Add a `tool_call_events` table that records one row per tool execution
(name, duration, success, error classification, args/result bytes),
mirrored on `llm_usage_events`'s shape. Switch both tables' `event_id`
generation to a deterministic SHA-256 hash so the recorder is safe to
move outside the in-process bus later. Add inert outbox columns
(`forwarded_at`, `forward_attempts`, `forward_error`) to both tables so
a future metering-vendor forwarder has a schema slot to write into. No
worker, no dashboard tab, no `args`/`result` content — bytes only.

## Decisions for Phase 4

### D1. Table shape — mirror `llm_usage_events` with per-call additions

New table `tool_call_events`. Columns:

| Column               | Type    | Constraints        | Notes                                                      |
| -------------------- | ------- | ------------------ | ---------------------------------------------------------- |
| `event_id`           | TEXT    | PRIMARY KEY        | SHA-256(turn_id + ':' + tool_call_id), 64 hex chars        |
| `turn_id`            | TEXT    | NOT NULL           | LLM turn this call belongs to                              |
| `occurred_at`        | INTEGER | NOT NULL           | epoch ms at execute_end                                    |
| `storage_context_id` | TEXT    | NOT NULL           | same as parent `llm:end` event                             |
| `context_type`       | TEXT    | NOT NULL           | `dm` / `group`                                             |
| `chat_user_id`       | TEXT    | NOT NULL           | same as parent                                             |
| `model`              | TEXT    | NOT NULL           | LLM model whose turn produced this call                    |
| `model_role`         | TEXT    | NOT NULL           | `main` / `small`                                           |
| `tool_name`          | TEXT    | NOT NULL           | e.g. `create_task`                                         |
| `tool_call_id`       | TEXT    | NOT NULL           | SDK-issued id (UUID)                                       |
| `success`            | INTEGER | NOT NULL           | `0` / `1`                                                  |
| `duration_ms`        | INTEGER |                    | from `tool:execute_end`                                    |
| `error_type`         | TEXT    |                    | from `tool:failure_classified` (may arrive later — UPDATE) |
| `error_code`         | TEXT    |                    | from classifier                                            |
| `retryable`          | INTEGER |                    | `0`/`1`/null                                               |
| `recovered`          | INTEGER |                    | `0`/`1`/null                                               |
| `args_bytes`         | INTEGER |                    | byteLength of JSON-stringified args                        |
| `result_bytes`       | INTEGER |                    | byteLength of JSON-stringified result (null on failure)    |
| `response_id`        | TEXT    |                    | parent LLM response id, turn-scoped (NOT per-call)         |
| `forwarded_at`       | INTEGER |                    | OUTBOX — null on insert                                    |
| `forward_attempts`   | INTEGER | NOT NULL DEFAULT 0 |                                                            |
| `forward_error`      | TEXT    |                    | last forward error                                         |

Indexes:

- `idx_tool_call_subject` on `(storage_context_id, occurred_at)`
- `idx_tool_call_chat_user` on `(chat_user_id, occurred_at)`
- `idx_tool_call_turn` on `(turn_id)`
- `idx_tool_call_tool` on `(tool_name, occurred_at)`
- `idx_tool_call_outbox` on `(occurred_at)` partial `WHERE forwarded_at IS NULL`

The partial index is supported by SQLite 3.8+ (Bun bundles current
SQLite). Falls back to a full index if the partial form rejects in
some downstream environment; the migration uses the partial form by
default.

### D2. Retrofit `llm_usage_events` with outbox columns

`llm_usage_events` gains three columns and one partial index:

- `forwarded_at INTEGER` (nullable)
- `forward_attempts INTEGER NOT NULL DEFAULT 0`
- `forward_error TEXT` (nullable)
- `idx_llm_usage_outbox` on `(occurred_at) WHERE forwarded_at IS NULL`

Migration adds the columns via `ALTER TABLE` and creates the partial
index. The Drizzle schema file is updated to include the new columns;
typegen sees them; the recorder's INSERT statements do not mention them
so the column defaults apply.

### D3. Deterministic `event_id` generation

Switch both tables to deterministic ids via SHA-256, truncated.

```ts
// src/usage/event-id.ts
import { createHash } from 'node:crypto'

export const usageEventId = (turnId: string | null, responseId: string | null, modelRole: string): string => {
  const input = `${turnId ?? ''}|${responseId ?? ''}|${modelRole}`
  return createHash('sha256').update(input).digest('hex')
}

export const toolCallEventId = (turnId: string, toolCallId: string): string => {
  return createHash('sha256').update(`${turnId}|${toolCallId}`).digest('hex')
}
```

64 hex chars (256 bits). Collision probability across 10⁹ rows is
~10⁻⁵⁸. Truncation to fewer bits is unnecessary; storage cost is
negligible.

`responseId` may be null (some self-hosted providers don't return it);
`turnId` may be null on `llm:error` events that escaped the
orchestrator before a turn was assigned. Both fallbacks are captured in
the function. The recorder MUST refuse to insert a usage row when both
`turnId` and `responseId` are null AND `modelRole` is the only input —
that would collide across all callsites. The recorder logs `warn` and
drops the row; tests cover this case.

Phase 2 rows in production keep their existing random UUIDs. No
backfill. The change to `event_id` shape is invisible to existing tests
because Phase 2's tests do not assert id shape.

### D4. Recorder strategy — INSERT on `tool:execute_end`, UPDATE on `tool:failure_classified`

The recorder subscribes to two new event types alongside the existing
`llm:end` / `llm:error` pair:

- `tool:execute_end` → INSERT a `tool_call_events` row with computed
  `event_id`. Classifier fields are NULL on first write.
- `tool:failure_classified` → UPDATE the row by `event_id`. If the row
  doesn't exist yet (classifier race), buffer the update for up to
  100ms then retry once; if it still fails, log `warn` and drop. Tests
  use fake timers to exercise both paths.

Rejected alternative: subscribe to `llm:end` only and unpack
`stepsDetail`. Too much data threading required because
`buildStepsDetail` doesn't carry duration or classifier info today,
and per-turn buffering complicates the recorder.

### D5. Event payload extensions

Two existing events grow their data payloads:

```ts
// src/llm-orchestrator-invoke.ts:78-86 (current shape)
emitUser(
  'tool:execute_end',
  contextId,
  {
    toolName,
    toolCallId,
    success,
    durationMs,
  },
  turnId,
)

// Phase 4 shape
emitUser(
  'tool:execute_end',
  contextId,
  {
    toolName,
    toolCallId,
    success,
    durationMs,
    argsBytes,
    resultBytes,
    chatUserId,
    contextType,
    model,
    modelRole,
    responseId,
  },
  turnId,
)
```

`tool:failure_classified` grows similarly (`chatUserId`, `contextType`
added). The orchestrator already has all these values in scope from
Phase 2's `InvokeModelArgs` extension.

`args` and `result` are JSON-stringified at emit time to compute byte
lengths; the strings are immediately discarded. The recorder never
sees the raw values. Contract: a unit test reads the event data shape
and asserts no `args` / `result` content fields exist.

### D6. Module layout

Extend `src/usage/`:

```text
src/usage/
  index.ts                   — subscribes once, dispatches on event type
  recorder.ts                — recordUsage()                  [Phase 2]
  tool-call-recorder.ts      — recordToolCall(), updateClassification()
  event-id.ts                — usageEventId, toolCallEventId  [Phase 4 new]
  query.ts                   — listSubjects, getSubjectDetail [Phase 2]
                             + listToolCallsForTurn, summarizeToolCallsBySubject [Phase 4 new]
  types.ts                   — UsageEvent, ToolCallEvent, RequestRow, ToolCallRow
```

Drizzle schema files:

```text
src/db/
  llm-usage-events-schema.ts          — extended with outbox columns
  tool-call-events-schema.ts          — new
  schema.ts                            — re-exports the new table
```

### D7. Migration sequence

Two migrations. Both are forward-only.

- **037_tool_call_events.ts** — `CREATE TABLE tool_call_events (...)`
  plus 5 indexes (including partial).
- **038_llm_usage_events_outbox.ts** — `ALTER TABLE llm_usage_events
ADD COLUMN forwarded_at INTEGER`, two more ALTERs, one partial
  index.

037 must land before 038 in execution order; the chain runner
guarantees numeric order. If 038's partial-index syntax is rejected
by a future SQLite version, the migration falls back to a full
index over `(occurred_at)`.

### D8. Read helpers

Phase 4 ships two:

```ts
// src/usage/query.ts (additions)

export interface ToolCallRow {
  eventId: string
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
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
  argsBytes: number | null
  resultBytes: number | null
  responseId: string | null
}

export const listToolCallsForTurn = (turnId: string): ToolCallRow[] => {
  /* ... */
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

export const summarizeToolCallsBySubject = (windowMs: number | null): ToolCallSubjectSummary[] => {
  /* ... */
}
```

Dashboard wiring is **out of scope** for Phase 4. Knip will mark these
exports as unused; we add a knip ignore comment in the existing
`fetchers.ts` Phase-3-pending pattern.

### D9. Subscriber lifetime

The recorder still uses Phase 2's `initUsageRecorder()` entry point.
Phase 4 broadens what it subscribes to (now 4 event types), keeps
the same "subscribe once at process start, never unsubscribe"
contract, and keeps the failure-isolation contract from Phase 2 (catch
internally, never rethrow into the bus dispatch chain).

### D10. No backfill

Rows start being written from Phase-4-deploy moment forward. No
synthetic backfill from Phase 3's `recentToolFailures` ring buffer or
from any historical bus state — that ring is ephemeral and would
produce gappy data.

## Non-goals (Phase 4)

- No outbox worker. Schema columns only.
- No dashboard tab or panel for tool-call drill-down.
- No removal of `recentToolFailures` (the ephemeral debug ring buffer).
- No removal or change of the `llm:tool_result` event (separate
  telemetry surface).
- No content storage. `args` and `result` never written; only byte
  lengths.
- No retroactive backfill of historical Phase-2 rows.
- No new dependency. SHA-256 via Node's `crypto.createHash`.
- No change to the chat surface, wizard, or LLM hot path beyond the
  two event payload extensions in `llm-orchestrator-invoke.ts`.

## Acceptance contract (Phase 4)

The Phase 4 PR is shippable when all of these hold:

1. **Schema present.** `bun test` includes new tests for migrations
   037 and 038; both pass against an in-memory DB.
2. **Recorder writes rows.** A live LLM turn that calls a tool yields
   exactly one `tool_call_events` row per call, with byte sizes
   populated and `event_id` deterministic.
3. **Classifier UPDATE works.** A tool failure produces a row with
   `success=0` initially, then the classifier UPDATE fills
   `error_type`, `error_code`, `retryable`, `recovered`. Tests cover
   both ordering races.
4. **Deterministic ids.** Re-running the recorder on the same event
   produces the same `event_id`; second insert fails the PK
   constraint and the recorder logs `warn`.
5. **Outbox columns inert.** `forwarded_at` is NULL,
   `forward_attempts` is 0 on every freshly inserted row across both
   tables. No code path reads or writes them yet.
6. **No content leaked.** A redaction-style test scans
   `tool_call_events` rows for substrings from a known tool's
   `args`/`result` and finds none.
7. **bun typecheck / lint / format / test / knip** all clean (knip
   exception via comment for the new query helpers).
8. **Manual smoke.** One DM message that triggers a `create_task`,
   one DM message that triggers a tool that fails (e.g. invalid
   args). Both produce rows; failure row gets classifier UPDATE.

## Rollback

- Migration 037 (new table) is one-way at the data level; rollback
  drops the table. No upstream data depends on it.
- Migration 038 (ALTER TABLE on `llm_usage_events`) is reversible by
  ALTER TABLE DROP COLUMN (SQLite 3.35+).
- Code rollback: revert the recorder additions and event payload
  extensions. Existing Phase 2 / Phase 3 code paths are unchanged
  modulo two event payload field additions, which are additive and
  safe to revert.

## Forward-compatibility check

- **Phase 5 (anonymous stats).** New table is read-only fodder for
  per-subject aggregates. Bytes-only contract aligns with Phase 5's
  anonymity envelope. No painted corners.
- **Future metering forwarder.** Outbox columns are pre-positioned on
  both tables. A future worker polls for `WHERE forwarded_at IS NULL`,
  forwards rows to a metering vendor, sets `forwarded_at = now()` or
  increments `forward_attempts` and writes `forward_error` on
  failure. Deterministic `event_id` makes forward operations safe to
  retry.
- **Future Phase 3 dashboard extensions.** Read helpers shipped here
  are the foundation; dashboard panels for tool-call detail are a
  small additive lift.

## Security review checkpoints

- Run `bun security` after the recorder changes. The new event
  payload extensions are the only addition to the LLM hot path; the
  recorder is read-decoupled from user-controlled input.
- The redaction-style test covers the anonymity-equivalent contract
  here: byte sizes only, no content.
- Outbox columns are written only by the (future) forwarder, never
  echoed back into LLM context or chat replies. No new prompt-
  injection surface.

## Documentation updates

- `CLAUDE.md` Architecture section: add `tool_call_events` next to
  `llm_usage_events` under "Architecture" / phase-3 billing notes.
- Migration index in `src/db/migrations/CLAUDE.md` if it exists; add
  037 and 038 entries.
- No user-facing doc changes; the bot's chat surface is unchanged.

## Open follow-ups for later phases

- **Tool-call dashboard panel.** A future Phase 3.5 (or phase 5
  integration) renders `tool_call_events` rows in the billing tab.
  Shape lives in the read helpers shipped here.
- **Metering forwarder.** Greenfield job-runner that polls the outbox
  columns. Triggered when billing research converges on a vendor.
- **`recentToolFailures` consolidation.** When the dashboard reads
  from `tool_call_events`, the ephemeral ring buffer can shrink or
  retire. Out of Phase 4 scope.
- **Phase 5 anonymous stats integration.** Add tool-call breakdown
  to the global/per-subject stats. The bytes-only contract makes
  this safe.
