# Goal

Add an error/failure-focused query helper over the persisted usage-event tables so operators can run post-restart post-mortems. Existing persisted-event queries are token/request-oriented (`listSubjects` in `src/usage/query.ts`, `listRecentRequests` in `src/usage/recent-requests.ts`) and never surface failure data, even though the tables already record it: `llm_usage_events.error` (set non-null exactly when a turn errored — see `buildUsageFromLlmError` in `src/usage/index.ts`) and `tool_call_events.success`/`error_type`/`error_code`/`retryable`/`recovered`.

# Files to touch

- New: `src/usage/failures.ts`
- New: `tests/usage/failures.test.ts`
- No schema/migration changes (tables and indexes already exist). No changes to `src/usage/index.ts` (it is the recorder subscriber, not a barrel; query modules are imported directly, as `src/debug/admin-system.ts` does).

# Intended behavior

`listRecentFailures(options: { windowMs?: number | null; limit?: number }): FailureRow[]` in `src/usage/failures.ts`, following the pattern of `src/usage/recent-requests.ts`:

- Sources, merged and returned newest-first (`occurred_at DESC`):
  - failed LLM turns: `llm_usage_events` rows where `error IS NOT NULL`;
  - failed tool calls: `tool_call_events` rows where `success = 0`.
- `windowMs`: when a positive number, only rows with `occurred_at >= Date.now() - windowMs`; `null`/omitted = all time (mirror `computeSince` in `src/usage/query.ts`).
- `limit`: clamped like `recent-requests.ts` (`Math.max(0, Math.min(200, Math.floor(limit)))`, default 25, `0` returns `[]`), applied after merging/ordering so the newest failures win.
- Row shape: discriminated union with a `kind: 'llm' | 'tool'` field plus shared fields (`ts`, `turnId`, `storageContextId`, `contextType`, `chatUserId`, `model`, `modelRole`, `durationMs`); `kind: 'llm'` adds `error` (string) and `finishReason` (string | null); `kind: 'tool'` adds `toolName`, `errorType`/`errorCode` (string | null), `retryable`/`recovered` (boolean | null). Implement via Drizzle (`getDrizzleDb()`, `src/db/schema.js`) with two selects and an in-memory merge+sort, or an equivalent single query — whichever is smaller.
- Usage recording behavior is unchanged; this is a read-only query helper.

## Non-goals

- Wiring into the debug/settings server or dashboard UI (can be a follow-up change once an operator surface is desired).
- Aggregations/summaries, analytics backfill changes, new indexes.

# Verification

- `tests/usage/failures.test.ts` using `setupTestDb()` + direct Drizzle inserts (pattern of `tests/usage/recent-requests.test.ts`), covering: only failed rows from each table are returned (successful LLM turns and `success = 1` tool calls excluded); merged result ordered newest-first across both tables; limit clamp (0, above 200, fractional); `windowMs` filtering vs all-time; nullable-field normalization (`finishReason`/`errorType`/`errorCode`/`retryable`/`recovered`/`durationMs`).
- Run `bun run test:failures` after a full `bun run test`, then `bun check:full` (lint + typecheck + knip) before handing off.
