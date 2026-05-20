# Phase 2 — Usage Telemetry Recorder — Implementation Plan

**Date:** 2026-05-19
**Status:** Draft
**Branch:** `claude/phase-2-llm-billing-J6vnM`
**Per-phase design:** [`../specs/2026-05-19-phase-2-usage-recorder-design.md`](../specs/2026-05-19-phase-2-usage-recorder-design.md)
**Brainstorm:** [`../notes/2026-05-19-phase-2-usage-recorder-brainstorm.md`](../notes/2026-05-19-phase-2-usage-recorder-brainstorm.md)
**Parent roadmap:** [`2026-05-19-central-llm-billing-roadmap.md`](2026-05-19-central-llm-billing-roadmap.md)

## Sequencing principle

The TDD hook (`CLAUDE.md` "TDD Enforcement") gates every `src/` edit on
a failing test. Each implementation step is split into:

- **T**: write the failing test(s).
- **I**: write the implementation that turns the tests green.
- **R**: refactor — only when there's something to refactor.

Steps are ordered so each leaves the tree green between steps.

## Step 0 — Pre-flight

- Confirm we are on branch `claude/phase-2-llm-billing-J6vnM`.
- `bun test` should pass on the baseline. If not, stop and investigate.
- `bun typecheck` should pass. Same.
- Confirm Phase 1's `system_config` table is in place (`grep
migration034SystemConfig src/db/index.ts`).

## Step 1 — Migration 035 (`llm_usage_events` table + indexes)

**T**: add `tests/db/migrations/035-llm-usage-events.test.ts` covering:

- Table exists after migration runs.
- All 4 indexes exist (`idx_llm_usage_subject`, `idx_llm_usage_chat_user`,
  `idx_llm_usage_turn`, `idx_llm_usage_occurred`).
- Inserting a minimal row works (PK + NOT NULL columns populated).
- Inserting two rows with the same `event_id` fails (PK).
- Inserting NULL into a NOT NULL column (`storage_context_id`,
  `context_type`, `chat_user_id`, `model`, `model_role`, `duration_ms`,
  `occurred_at`) fails.
- Optional columns (`turn_id`, `input_tokens`, `output_tokens`,
  `finish_reason`, `response_id`, `error`) accept NULL.
- `step_count`, `tool_call_count`, `message_count` default to 0 when
  omitted from the INSERT column list.
- Running the migration twice is idempotent (`IF NOT EXISTS` on table
  and indexes).

Copy structure from
`tests/db/migrations/034_system_config.test.ts`.

**I**: add `src/db/migrations/035_llm_usage_events.ts` per design D7.
Register in `src/db/index.ts` between
`migration034SystemConfig` and `migration036DropUserLlmConfig`
(both the import and the `MIGRATIONS` array).

**R**: none.

**Verify**: `bun test tests/db/migrations/035-llm-usage-events.test.ts`.

## Step 2 — Drizzle schema

**T**: add a unit test `tests/db/llm-usage-events-schema.test.ts`
covering:

- A Drizzle `insert(llmUsageEvents).values({...}).run()` followed by
  `select().from(llmUsageEvents).all()` round-trips all fields,
  including nullable ones returning `null`.
- `setupTestDb()` runs migrations so the table exists.

**I**:

- Add `src/db/llm-usage-events-schema.ts` per design D6.
- Re-export `llmUsageEvents` and `LlmUsageEventRow` from
  `src/db/schema.ts`.

**R**: none.

**Verify**: `bun test tests/db/llm-usage-events-schema.test.ts && bun typecheck`.

## Step 3 — Types and recorder skeleton

This step ships `types.ts` and the recorder implementation without
wiring it into the bus yet.

**T**: `tests/usage/recorder.test.ts`:

- `recordUsage({ ...validPayload })` inserts a row; subsequent SELECT
  returns the same fields, with NULLs preserved.
- `recordUsage` generates a unique `event_id` per call (two consecutive
  calls produce two distinct rows).
- `recordUsage` does not throw when given an unusable payload — it
  logs at `error` level and returns. (Simulate by mocking
  `getDrizzleDb()` to return an object whose `.insert()` throws.)
- `recordUsage` accepts `input_tokens: null` and `output_tokens: null`
  on success rows.
- `recordUsage` accepts an `error` string and persists it.
- Default counts (0) are respected when caller passes 0 explicitly.

DI shape: the recorder uses `getDrizzleDb()` directly (matching
`system-config.ts`). For the "insert throws" test, use `mock.module`
to override `getDrizzleDb` for that test only.

**I**:

- `src/usage/types.ts` — type exports per design D2.1.
- `src/usage/recorder.ts` — `recordUsage` implementation per design
  D2.2. Module-local `log = logger.child({ scope: 'usage:recorder' })`.

**R**: none.

**Verify**: `bun test tests/usage/recorder.test.ts && bun typecheck`.

## Step 4 — Query module

**T**: `tests/usage/query.test.ts`:

- `listSubjects({ windowMs: null })` over a seeded fixture (3 subjects
  × multiple modelRoles) returns one `SubjectSummary` per
  `storage_context_id` with totals matching hand-rolled SUM/COUNT.
- `listSubjects({ windowMs: 24 * 3600 * 1000 })` filters by time
  correctly (rows older than 24h are excluded).
- `listSubjects` populates all three `modelRole` slots in `totals`,
  even when a subject has no rows for one role (zeros).
- `getSubjectDetail('subject-1', { windowMs: null })` returns rows
  ordered by `occurredAt` descending.
- `getSubjectDetail` filters by `storageContextId` (rows from other
  subjects excluded).
- `getSubjectDetail` filters by window.
- Empty seed: `listSubjects` returns `[]`, `getSubjectDetail` returns
  `[]`.

**I**: `src/usage/query.ts` per design D8. Helper `pivotByRole(rows)`
folds the per-role aggregate rows into the `SubjectSummary` shape.

**R**: extract `pivotByRole` if it becomes its own logical unit, but
keep it module-local.

**Verify**: `bun test tests/usage/query.test.ts && bun typecheck`.

## Step 5 — `emitLlmEnd` and `emitLlmError` signature extensions

This step changes the emit functions' shape. Hot-path code; both
implementation and its callers must update in one batch so the tree
stays green at step boundary.

**T**:

- Extend `tests/llm-orchestrator-events.test.ts` to assert the
  extended `emitLlmEnd` payload contains `chatUserId` and `contextType`.
  The existing assertions on `model`, `messageCount`, etc. continue
  to hold.
- Extend `tests/llm-orchestrator-support.test.ts` (create if absent)
  to assert `emitLlmError` payload contains `error`, `model`,
  `chatUserId`, `contextType`, `durationMs`, `messageCount`.
- Drop assertions on the unused `emitLlmEnd` overloads (if any).

**I**:

- `src/llm-orchestrator-events.ts:153-202` — collapse `emitLlmEnd` to
  one signature `(contextId, chatUserId, contextType, mainModel, result, startTime, messages, tools, routing, turnId)`.
  Update the emit payload to include `chatUserId` and `contextType`.
- `src/llm-orchestrator-support.ts:161-181` — update `emitLlmError`
  signature per design D3.2.
- `src/llm-orchestrator-types.ts:55` — add `chatUserId` and
  `contextType` to `InvokeModelArgs`.
- `src/llm-orchestrator-invoke.ts:97,108` — pass new fields into
  `emitLlmStart` (kept as-is; brainstorm flagged this is not necessary
  for the recorder but it keeps the start/end pair symmetric — DECISION:
  leave `emitLlmStart` unchanged to minimize blast radius; the
  recorder only consumes `llm:end`. Update only `emitLlmEnd`.)
- `src/llm-orchestrator-tools.ts` — find `prepareLlmInvocation`,
  thread `chatUserId` and `contextType` into the returned
  `InvokeModelArgs`. Adjust its signature and callers.
- `src/llm-orchestrator.ts:217-256` — capture `startedAt` and
  `messageCount` before the `try`; resolve `mainModel` before the
  `try`; pass to `emitLlmError` on the catch path. Thread
  `chatUserId`, `contextType`, `mainModel` into `callLlm` and onward
  to `prepareLlmInvocation`.

**R**: none.

**Verify**:

```
bun test tests/llm-orchestrator-events.test.ts
bun test tests/llm-orchestrator-support.test.ts
bun test tests/llm-orchestrator.test.ts
bun typecheck
```

Note for the TDD hook: each `src/` edit needs its test green by the
time the hook runs. Sequence T-then-I within this step strictly:

1. Update tests for `emitLlmEnd` first.
2. Update `src/llm-orchestrator-events.ts`.
3. Update tests for `emitLlmError`.
4. Update `src/llm-orchestrator-support.ts`.
5. Update tests for `InvokeModelArgs` consumers (if any).
6. Update `src/llm-orchestrator-types.ts`,
   `src/llm-orchestrator-tools.ts`,
   `src/llm-orchestrator-invoke.ts`,
   `src/llm-orchestrator.ts`.

If a callsite update causes an unrelated test to red, fix forward in
the same step; do not leave intermediate red between steps.

## Step 6 — Bus subscriber (`src/usage/index.ts`)

**T**: `tests/usage/recorder-integration.test.ts`:

- After `initUsageRecorder()`, emitting an `llm:end` event via
  `emitUser('llm:end', ...)` with a populated payload produces a row
  with the expected `model`, `model_role: 'main'`,
  `storage_context_id`, `chat_user_id`, `context_type`,
  `step_count`, `tool_call_count`, `message_count`, `duration_ms`,
  `finish_reason`, `response_id`, `input_tokens`, `output_tokens`,
  `turn_id`, `error: null`.
- Emitting `llm:error` produces a row with `error` populated,
  `model_role: 'main'`, NULL `input_tokens` / `output_tokens` /
  `response_id` / `finish_reason`, and the fields from the error
  payload.
- Other event types (`llm:start`, `tool:request`, etc.) produce no
  rows.
- A second `initUsageRecorder()` call does not register a second
  subscriber (idempotency in test harness setup). Either a guard
  inside `initUsageRecorder` or the helper `subscribe()` semantics
  (it's a `Set`, so identical fn references dedupe naturally) — use
  a module-local boolean to be explicit.
- A recorder exception (mock `recordUsage` to throw) does not
  propagate; the test asserts a second listener registered after the
  failing handler still receives the event.

**I**: `src/usage/index.ts`:

- `initUsageRecorder()` exported; uses a module-local `initialised`
  flag to no-op on second call.
- `handleEvent(event)` dispatches on `event.type`.
- `recordFromLlmEnd(event)` — read fields from `event.data`,
  build a `UsageEvent`, call `recordUsage`. Wrap in try/catch
  internally so a malformed event doesn't kill the subscriber.
- `recordFromLlmError(event)` — same shape but with `error` set and
  count/duration fields filled from the payload (defaults to 0
  where missing).

**R**: none.

**Verify**: `bun test tests/usage/recorder-integration.test.ts && bun typecheck`.

## Step 7 — Embedding callsites

**T**: `tests/embeddings.test.ts` (extend; create if absent):

- `tryGetEmbedding(text, key, url, model, context, deps)` with a mock
  `embed` that returns `{ embedding: [...], usage: { tokens: 42 } }`
  inserts a row with `model_role: 'embedding'`, `input_tokens: 42`,
  `output_tokens: null`, `step_count: 0`, `tool_call_count: 0`,
  `message_count: 0`, and the context fields from the call.
- Same call with `usage` undefined inserts the row with
  `input_tokens: null`.
- A throwing `embed` causes `tryGetEmbedding` to return `null` AND
  insert a row with `error` populated.

**I**:

- `src/embeddings.ts` — add `EmbeddingCallContext` type;
  widen `getEmbedding` and `tryGetEmbedding` signatures. Insert
  `recordUsage` calls after success and inside the catch.

The new param breaks two callsites — they need updating in the same
step or tests for those callsites fail.

**T (memo callsites)**: `tests/tools/save-memo.test.ts`,
`tests/tools/search-memos.test.ts`:

- Calling the tool with a known storageContextId / chatUserId emits a
  recorder row tagged with those values when the embedding model is
  configured.

**I (memo callsites)**:

- `src/tools/save-memo.ts:38` — build `EmbeddingCallContext` from
  `userId` (storage), `contextType` (from tool options), `userId`
  (chat user — same as storage in DM-only memo context). Pass it.
- `src/tools/search-memos.ts:95` — same.

Confirm `contextType` is exposed by the tool factory's options. If
not, thread it through (`src/tools/CLAUDE.md` says `MakeToolsOptions`
already carries it).

**R**: none.

**Verify**:

```
bun test tests/embeddings.test.ts
bun test tests/tools/save-memo.test.ts
bun test tests/tools/search-memos.test.ts
bun typecheck
```

## Step 8 — Web distill callsite

**T**: `tests/web/distill.test.ts`:

- `distillWebContent({ storageContextId, contextType, chatUserId, title, content })`
  inserts a row with `model_role: 'small'`, `step_count >= 1`,
  `tool_call_count: 0`, `message_count: 1`, the context fields, and
  `model` matching the small model (or main model fallback).
- A throwing `generateText` causes `distillWebContent` to throw AND
  insert an error row.

**I**:

- `src/web/distill.ts` — widen `distillWebContent` input type; call
  `recordUsage` after `generateText` (success) and in a try/catch on
  failure.

**T (callsite)**: find where `distillWebContent` is called from. Use
`grep distillWebContent src/`. Likely `src/web/fetch.ts` or a
`web_fetch` tool. Update its test to assert the context fields flow
through.

**I (callsite)**: thread `chatUserId` and `contextType` through to
the call. If the calling tool is `web_fetch`, its tool options
already carry both.

**Verify**:

```
bun test tests/web/distill.test.ts
bun test tests/web/<callsite>.test.ts
bun typecheck
```

## Step 9 — `initUsageRecorder` wiring in `src/index.ts`

**T**: no new unit test — `src/index.ts` is not exercised by the test
runner. Manual smoke in Step 12 covers it.

**I**:

- Add `import { initUsageRecorder } from './usage/index.js'`.
- Call `initUsageRecorder()` after `seedSystemConfigFromEnv()` /
  `missingSystemConfigKeys()` block, before `initializeMessageCache()`.

**R**: none.

**Verify**: `bun typecheck`.

## Step 10 — Cross-cutting type and orchestrator-end test

Now that all writers are in place, write the end-to-end orchestrator
test.

**T**: `tests/llm-orchestrator.test.ts` — extend (or add new test):

- A `processMessage` happy path (mock `generateText` to return a
  minimal result) produces one row in `llm_usage_events` after the
  call returns. Row fields match the orchestrator inputs.
- A `processMessage` where `generateText` throws produces one row
  with `error` populated, NULL token/response fields, `model_role:
'main'`.

If the existing orchestrator test file is too tangled to extend
cleanly, add a focused `tests/usage/end-to-end.test.ts` that drives
`processMessage` directly.

**I**: no new src code; this test validates the wiring done in earlier
steps. If it fails, fix in the relevant earlier step's code.

**R**: none.

**Verify**: `bun test tests/llm-orchestrator.test.ts && bun typecheck`.

## Step 11 — Full suite + lint + typecheck + security

Run in order; do not skip:

1. `bun typecheck`
2. `bun lint`
3. `bun test` — main curated suite
4. `bun test:client` — dashboard tests (should be untouched but
   confirm no upstream type leak broke a client import)
5. `bun format:check` (run `bun format` to fix if needed)
6. `bun security` — Semgrep

Any failure pauses the plan and we fix forward.

## Step 12 — Manual smoke (mandatory acceptance)

1. Fresh DB (`rm papai.db*` in a scratch dir).
2. `LLM_API_KEY=… LLM_BASE_URL=… MAIN_MODEL=… EMBEDDING_MODEL=… ADMIN_USER_ID=… CHAT_PROVIDER=telegram TASK_PROVIDER=kaneo KANEO_CLIENT_URL=… bun start`.
3. Verify startup logs include `"usage recorder initialised"`.
4. Send a single chat message and let it complete normally.
5. `sqlite3 papai.db 'SELECT event_id, model_role, model, storage_context_id, chat_user_id, context_type, step_count, tool_call_count, message_count, input_tokens, output_tokens, duration_ms, error FROM llm_usage_events ORDER BY occurred_at DESC LIMIT 5'`
   - Expect one `model_role='main'` row with populated counts and
     either tokens or NULLs (depending on provider).
6. Save a memo (`save a note: testing usage recorder`). The bot calls
   `tryGetEmbedding` which records.
   - Expect a `model_role='embedding'` row, `input_tokens` populated
     if your endpoint returns usage.
7. Trigger `web_fetch` on a URL with >8000 chars of content so distill
   runs. Expect a `model_role='small'` row.
8. Force an error: temporarily set `LLM_API_KEY` to an invalid value
   in `system_config`, restart, send a message. Expect a row with
   `error` set, `model_role='main'`.
9. Reset key, restart, verify normal behavior resumes.

Capture the SQL output in the PR description as smoke evidence.

## Step 13 — Commit + push

One commit per substep is overkill for review. Group:

- **Commit A**: migration 035 + Drizzle schema + their tests.
- **Commit B**: `src/usage/` module (types, recorder, query) + their
  tests.
- **Commit C**: `emitLlmEnd`/`emitLlmError` signature extension +
  `InvokeModelArgs` plumbing + orchestrator test updates.
- **Commit D**: bus subscriber (`src/usage/index.ts`) + integration
  tests + `initUsageRecorder()` wiring in `src/index.ts`.
- **Commit E**: embedding callsite updates (`embeddings.ts`,
  `save-memo.ts`, `search-memos.ts`) + tests.
- **Commit F**: distill callsite update + tests.

If a hook fails on a commit, fix the underlying issue and create a
new commit (no `--amend`, no `--no-verify` per `CLAUDE.md`).

Push to `claude/phase-2-llm-billing-J6vnM` with
`git push -u origin claude/phase-2-llm-billing-J6vnM`.

## Step 14 — Review

Per the roadmap:

- `bun security` already run in Step 11; investigate any findings.
- Manual smoke notes from Step 12 in the PR description so reviewer
  can reproduce.
- No dashboard walkthrough applicable (Phase 3 territory).

## Risks + mitigations

| Risk                                                                        | Mitigation                                                                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TDD hook blocks an `src/` edit because the new test was not yet written     | Strict T → I sequencing inside each step; the order is documented above                                                          |
| `emitLlmEnd` signature change ripples through multiple files                | Step 5 batches all callers; tests cover the new fields in one suite                                                              |
| Bus dispatch no longer short-circuits, hot-path cost                        | The expensive payload builders run upstream of dispatch regardless; net cost is a single Set-iteration step per emit             |
| Recorder exception kills the bus                                            | Catch internally per design D2.2; integration test asserts other listeners still fire after a failing recorder                   |
| `embed()` shape difference across `@ai-sdk` versions                        | Treat `usage` as `{ tokens?: number } \| undefined` and pass through `?? null`; never crash on missing fields                    |
| Tool-option `contextType` not actually exposed to the embedding tools today | Audit `MakeToolsOptions` flow in `src/tools/tools-builder.ts` during Step 7; thread if missing — this is a small, bounded change |
| Migration 035 collides with an in-flight `claude/phase-2*` branch elsewhere | Branch ownership: only this branch is authorized; CI enforces unique migration ids                                               |
| Test isolation: cache state in `usage/index.ts` persists across tests       | Use the standard test-helpers reset path; expose a `resetUsageRecorderForTesting()` helper if needed                             |
| `recordUsage` from inside the bus dispatcher creates re-entrancy on the bus | Recorder does NOT emit any bus events; pure DB insert. Confirmed.                                                                |
| `bun security` flags the new SQL                                            | Drizzle parameterizes by default; raw SQL only in the migration. Inspect any finding rather than silencing.                      |

## Out-of-plan checklist before Step 13

- [ ] No `eslint-disable`, `oxlint-disable`, `@ts-ignore`, or
      `@ts-nocheck` comments anywhere (hook policy)
- [ ] `bun knip` shows no new unused exports
- [ ] `bun duplicates` does not regress
- [ ] `tests/CLAUDE.md` style respected for new tests (DI-first,
      mock-reset, no top-level mock.module without local reason)
- [ ] All new modules ship with structured pino logging at the
      documented levels
- [ ] `tests/usage/recorder.test.ts` covers the "recorder must not
      throw" invariant explicitly

## Notes for follow-up phases

- The `displayName` field for `SubjectSummary` (parent design D6)
  remains a Phase 3 concern.
- The HTTP routes `/billing/subjects`, `/billing/subject/:id`,
  `/admin/llm` are all Phase 3.
- Per-tool drill-down (Phase 4) reuses the recorder pattern with a
  parallel `tool_call_events` table.
- The deterministic `event_id` (Phase 4) swaps `crypto.randomUUID()`
  for a hash; the column type doesn't change.
